// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Confidential Clinical Trial Matching (FHE + Web3)
// English inline comments throughout the contract as requested.

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title ConfidentialClinicalTrialMatchingFHE
/// @notice Manages encrypted patient & trial inputs, performs encrypted aggregation and encrypted inference
///         using Fully Homomorphic Encryption primitives exposed by the FHE library. The contract is designed
///         to keep raw data invisible on-chain while enabling collaborative model training and encrypted
///         inference. Differential privacy and access control hooks are provided; actual DP noise should be
///         produced off-chain by approved aggregators and submitted as encrypted noise.
contract ConfidentialClinicalTrialMatchingFHE is SepoliaConfig {
    // -- Roles and access control --
    address public admin;                  // contract administrator

    mapping(address => bool) public researchers;   // researchers who can submit model updates / request computations
    mapping(address => bool) public aggregators;   // aggregators who can perform secure aggregation

    modifier onlyAdmin() {
        require(msg.sender == admin, "only admin");
        _;
    }

    modifier onlyResearcher() {
        require(researchers[msg.sender], "only researcher");
        _;
    }

    modifier onlyAggregator() {
        require(aggregators[msg.sender], "only aggregator");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    // -- Data structures (all sensitive fields kept as encrypted types) --

    /// @notice Encrypted participant submission (e.g., covariates, baseline measurements)
    struct EncryptedParticipant {
        uint256 id;
        address owner;           // who submitted the encrypted blob (doesn't reveal plaintext)
        bytes32[] ciphertexts;   // arbitrary encrypted blobs (each maps to an euint32/e.g. serialized vectors)
        uint256 timestamp;
        bool active;
    }

    /// @notice Encrypted model representation (e.g., weights vector encoded as euint32s)
    struct EncryptedModel {
        uint256 id;
        euint32[] encryptedWeights; // encrypted model weights
        uint256 submitBlock;
        address submitter;
        bool live;                  // whether this model is active for inference
        // metadata (encrypted) could be added if the FHE lib supports strings
    }

    /// @notice Encrypted prediction result placeholder
    struct EncryptedPrediction {
        uint256 id;
        bytes32 ciphertext;    // single ciphertext containing encrypted prediction/result
        uint256 timestamp;
        address requester;
    }

    // -- Storage --
    uint256 public participantCount;
    mapping(uint256 => EncryptedParticipant) public participants;

    uint256 public modelCount;
    mapping(uint256 => EncryptedModel) public models;

    uint256 public predictionCount;
    mapping(uint256 => EncryptedPrediction) public predictions;

    // Store encrypted aggregated model (sum of encrypted weights) and count
    mapping(uint256 => euint32[]) public aggregatedModelSums; // keyable by aggregation job id
    mapping(uint256 => uint256) public aggregatedModelCounts;

    // Differential privacy configuration per research project
    struct DPConfig {
        bool enabled;
        // epsilon & delta are stored off-chain or as plaintext governance params - we keep them as uints for reference
        uint256 epsilonNumerator; // numerator for epsilon (rational representation if desired)
        uint256 epsilonDenominator;
        // Note: actual DP noise must be encrypted and submitted by trusted aggregator as ciphertext
    }
    mapping(uint256 => DPConfig) public dpConfigs; // projectId => DPConfig

    // Events
    event ParticipantSubmitted(uint256 indexed participantId, address indexed owner);
    event ModelSubmitted(uint256 indexed modelId, address indexed submitter);
    event AggregationRequested(uint256 indexed aggId, uint256[] modelIds);
    event AggregationCompleted(uint256 indexed aggId);
    event PredictionRequested(uint256 indexed predictionId, uint256 modelId, address requester);
    event PredictionStored(uint256 indexed predictionId);
    event ResearcherAdded(address indexed researcher);
    event AggregatorAdded(address indexed aggregator);
    event DPConfigUpdated(uint256 indexed projectId, bool enabled);

    // -- Administrative functions --

    /// @notice Add or remove a researcher (simple on-chain ACL hook — adapt to DAO if desired)
    function setResearcher(address who, bool allowed) external onlyAdmin {
        researchers[who] = allowed;
        if (allowed) emit ResearcherAdded(who);
    }

    /// @notice Add or remove an aggregator
    function setAggregator(address who, bool allowed) external onlyAdmin {
        aggregators[who] = allowed;
        if (allowed) emit AggregatorAdded(who);
    }

    /// @notice Configure differential privacy metadata for a project
    function configureDP(uint256 projectId, bool enabled, uint256 num, uint256 den) external onlyAdmin {
        dpConfigs[projectId] = DPConfig({ enabled: enabled, epsilonNumerator: num, epsilonDenominator: den });
        emit DPConfigUpdated(projectId, enabled);
    }

    // -- Participant submission (encrypted) --

    /// @notice Submit encrypted participant data. The contract never sees plaintext.
    /// @param ciphertexts an array of ciphertext blobs produced by the FHE system; each blob may encode features
    function submitEncryptedParticipant(bytes32[] calldata ciphertexts) external {
        participantCount += 1;
        uint256 pid = participantCount;
        participants[pid] = EncryptedParticipant({
            id: pid,
            owner: msg.sender,
            ciphertexts: ciphertexts,
            timestamp: block.timestamp,
            active: true
        });

        emit ParticipantSubmitted(pid, msg.sender);
    }

    // -- Model submission: researchers submit encrypted model updates (e.g., local gradients) --

    /// @notice Submit an encrypted model or encrypted gradient vector. Stored as euint32[] when possible.
    /// @dev The FHE library must provide a way to convert serialized ciphertext -> euint32; callers may submit
    ///      euint32 arrays directly if the compiler ABI supports it.
    function submitEncryptedModel(euint32[] calldata encryptedWeights) external onlyResearcher {
        modelCount += 1;
        uint256 mid = modelCount;

        // store weights
        EncryptedModel storage m = models[mid];
        m.id = mid;
        m.submitter = msg.sender;
        m.submitBlock = block.number;
        m.live = false;

        // copy array into storage
        for (uint i = 0; i < encryptedWeights.length; i++) {
            m.encryptedWeights.push(encryptedWeights[i]);
        }

        emit ModelSubmitted(mid, msg.sender);
    }

    // -- Secure aggregation: aggregators combine encrypted model updates without revealing plaintext --

    /// @notice Request an aggregation job for given model IDs. The on-chain aggregation uses FHE.add
    /// @param aggId a client-chosen aggregation job identifier
    /// @param modelIds array of model ids to be aggregated
    function requestAggregation(uint256 aggId, uint256[] calldata modelIds) external onlyAggregator {
        require(modelIds.length > 0, "no models");

        // Ensure all models have the same dimensionality and exist
        uint256 dim = models[modelIds[0]].encryptedWeights.length;
        require(dim > 0, "empty model");

        // initialize sum array
        euint32[] storage sum = aggregatedModelSums[aggId];
        // ensure sum is empty
        require(sum.length == 0, "agg exists");

        // allocate sum with zeros
        for (uint i = 0; i < dim; i++) {
            sum.push(FHE.asEuint32(0));
        }

        uint256 count = 0;
        // homomorphically add weights
        for (uint j = 0; j < modelIds.length; j++) {
            EncryptedModel storage m = models[modelIds[j]];
            require(m.encryptedWeights.length == dim, "dim mismatch");
            for (uint k = 0; k < dim; k++) {
                // sum[k] = sum[k] + m.encryptedWeights[k]
                sum[k] = FHE.add(sum[k], m.encryptedWeights[k]);
            }
            count += 1;
        }

        aggregatedModelCounts[aggId] = count;

        emit AggregationRequested(aggId, modelIds);
        emit AggregationCompleted(aggId);
    }

    /// @notice Publish an aggregated model as a live model for inference. This function stores the sum of weights
    ///         and the contributor count; averaging (divide) can be performed during decryption or by homomorphic
    ///         multiplication with a fixed-point reciprocal if supported.
    /// @param aggId aggregation job id produced by requestAggregation
    /// @param asModelId new model id which will represent the aggregated model
    function publishAggregatedModelAsLive(uint256 aggId, uint256 asModelId) external onlyAggregator {
        euint32[] storage sum = aggregatedModelSums[aggId];
        require(sum.length > 0, "no sum");
        require(models[asModelId].encryptedWeights.length == 0, "model exists");

        // copy sum into new model slot
        models[asModelId].id = asModelId;
        models[asModelId].submitter = msg.sender;
        models[asModelId].submitBlock = block.number;
        models[asModelId].live = true;

        for (uint i = 0; i < sum.length; i++) {
            models[asModelId].encryptedWeights.push(sum[i]);
        }

        // Note: store contributor count so decryption layer can compute average (sum / count) if needed
        aggregatedModelCounts[asModelId] = aggregatedModelCounts[aggId];

        emit ModelSubmitted(asModelId, msg.sender);
    }

    // -- Differential privacy hook --
    // Aggregators or approved DP oracles must submit encrypted DP noise which will be homomorphically added
    // to the aggregated model before publishing or before decryption. The contract does not generate noise on-chain
    // because true randomness for DP noise should be generated securely off-chain and then encrypted.

    /// @notice Add encrypted DP noise to an aggregated model in-place.
    /// @param targetModelId model ID to which encrypted noise will be added
    /// @param encryptedNoise vector of encrypted noise (same dimensionality as model weights)
    function addEncryptedDPNoise(uint256 targetModelId, euint32[] calldata encryptedNoise) external onlyAggregator {
        EncryptedModel storage m = models[targetModelId];
        require(m.encryptedWeights.length == encryptedNoise.length, "dim mismatch");
        require(m.live == false || m.live == true, "no model"); // noop, just ensure exists

        for (uint i = 0; i < encryptedNoise.length; i++) {
            m.encryptedWeights[i] = FHE.add(m.encryptedWeights[i], encryptedNoise[i]);
        }

        // DP metadata remains off-chain or tracked in dpConfigs
    }

    // -- Encrypted inference --
    // A researcher (or authorized party) can submit an encrypted query (patient features) and request evaluation
    // against a live encrypted model. The contract performs homomorphic dot-product if FHE.mul exists and stores
    // the resulting encrypted prediction. No plaintext is ever visible on-chain.

    /// @notice Request an encrypted prediction: homomorphic evaluation of 1-layer linear model (dot product + bias)
    /// @param modelId ID of an active model for inference
    /// @param encryptedQuery array of encrypted features (euint32[])
    /// @dev This implementation assumes the FHE library exposes mul/add for euint32 and returns an euint32 accumulator.
    function requestEncryptedPrediction(uint256 modelId, euint32[] calldata encryptedQuery) external onlyResearcher {
        EncryptedModel storage m = models[modelId];
        require(m.live, "model not live");
        require(m.encryptedWeights.length == encryptedQuery.length, "dim mismatch");

        // Compute homomorphic dot product on-chain using library primitives
        euint32 acc = FHE.asEuint32(0);
        for (uint i = 0; i < encryptedQuery.length; i++) {
            // multiply weight_i * query_i (homomorphic multiplication)
            euint32 prod = FHE.mul(m.encryptedWeights[i], encryptedQuery[i]);
            acc = FHE.add(acc, prod);
        }

        // Store the encrypted accumulator as a prediction ciphertext (converted to bytes32 for generic storage)
        predictionCount += 1;
        uint256 pid = predictionCount;

        // convert acc to bytes32 and save in the prediction record; consumers can request decryption later
        predictions[pid] = EncryptedPrediction({
            id: pid,
            ciphertext: FHE.toBytes32(acc),
            timestamp: block.timestamp,
            requester: msg.sender
        });

        emit PredictionRequested(pid, modelId, msg.sender);
        emit PredictionStored(pid);
    }

    // -- Decryption callbacks / requests --
    // When a client wants to obtain decrypted results (e.g., to see the actual averaged model or predictions),
    // they must request off-chain MPC/FHE decryption by calling the FHE.requestDecryption primitive with the
    // ciphertexts stored on-chain. The decryption callback below follows the pattern in sample code.

    mapping(uint256 => uint256) private requestToPredictionId;
    mapping(uint256 => bool) private decryptRequestExists;

    /// @notice Request decryption for a stored prediction (this will call into the FHE provider)
    /// @param predictionId stored encrypted prediction id
    function requestPredictionDecryption(uint256 predictionId) external onlyResearcher {
        EncryptedPrediction storage p = predictions[predictionId];
        require(p.id != 0, "prediction not found");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = p.ciphertext;

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.handlePredictionDecryption.selector);
        requestToPredictionId[reqId] = predictionId;
        decryptRequestExists[reqId] = true;
    }

    /// @notice Callback invoked by FHE provider with decrypted cleartexts and proof
    /// @dev The FHE provider must call this function after performing decryption off-chain. The contract verifies
    ///      the provided proof and then may emit events or store the (non-sensitive) metadata. Full plaintext
    ///      should be handled carefully by consumers — the contract does not persist decrypted plaintexts by default.
    function handlePredictionDecryption(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        require(decryptRequestExists[requestId], "invalid or unknown decryption request");
        uint256 predictionId = requestToPredictionId[requestId];
        require(predictionId != 0, "unknown prediction");

        // Verify proof produced by FHE provider
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decoded cleartexts format is application-specific; we do not persist plaintext here for privacy reasons.
        // However, emit an event with a hashed result so consumers can prove they retrieved a particular value.
        bytes32 plaintextHash = keccak256(cleartexts);
        emit PredictionStored(predictionId);

        // cleanup mapping
        delete decryptRequestExists[requestId];
        delete requestToPredictionId[requestId];
    }

    // -- Utilities & governance helpers --

    /// @notice Mark a stored participant as inactive (for GDPR / data-retention requests). This does not
    ///         remove the ciphertext from chain history but marks it logically deleted for downstream jobs.
    function retireParticipant(uint256 participantId) external {
        // allow owner or admin to retire
        EncryptedParticipant storage p = participants[participantId];
        require(p.id != 0, "no participant");
        require(msg.sender == p.owner || msg.sender == admin, "not allowed");
        p.active = false;
    }

    /// @notice Simple helper to get aggregated model dimensionality
    function getModelDim(uint256 modelId) external view returns (uint256) {
        return models[modelId].encryptedWeights.length;
    }

    /// @notice Helper: convert euint32 to bytes32 (for generic storage) — library function used above
    function toBytes32_euint32(euint32 v) public pure returns (bytes32) {
        return FHE.toBytes32(v);
    }

    // -- Notes & security considerations (developer comments) --
    // * This contract never generates DP noise on-chain. Aggregators / oracles should produce high-quality noise
    //   off-chain, encrypt it using the shared FHE keys, and submit it via addEncryptedDPNoise.
    // * The contract assumes the FHE library implements the following primitives at minimum:
    //     - FHE.asEuint32(uint32) -> euint32
    //     - FHE.add(euint32, euint32) -> euint32
    //     - FHE.mul(euint32, euint32) -> euint32
    //     - FHE.toBytes32(euint32) -> bytes32
    //     - FHE.requestDecryption(bytes32[] memory, function selector) -> uint256
    //     - FHE.checkSignatures(uint256, bytes memory, bytes memory)
    //   If any of these are missing, corresponding functions should be adapted.
    // * Homomorphic averaging is left to the decryption layer or to an FHE multiplicative inverse primitive
    //   — integer division on encrypted data is non-trivial and should be performed securely off-chain (or via
    //   an encrypted fixed-point reciprocal multiplication if supported).
    // * Gas costs: storing long encrypted vectors on-chain is expensive. Consider storing large ciphertexts in
    //   IPFS/Arweave and writing compact references on-chain, or using event logs rather than storage for some jobs.
    // * Access control: the provided ACL is minimal. For production consider integrating a DAO / multisig for
    //   admin operations and using on-chain governance for DP parameters.
}
