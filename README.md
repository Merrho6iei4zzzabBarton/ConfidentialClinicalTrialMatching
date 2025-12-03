# Confidential Clinical Trial Matching

A privacy-preserving decentralized clinical trial matching platform built on Ethereum, leveraging Zama’s Fully Homomorphic Encryption (FHE) to enable computation on encrypted data. This ensures that sensitive clinical data remains confidential while still enabling collaborative model training and encrypted inference.

## Project Background

Traditional clinical trial matching systems face significant challenges:

• Privacy risks: Patients and research institutions are hesitant to share raw clinical data  
• Centralized control: Data silos hinder collaboration and limit transparency  
• Trust deficit: Patients and researchers cannot fully verify how their data is used  
• Limited scalability: Secure and privacy-preserving data sharing is hard to achieve  

Confidential Clinical Trial Matching addresses these challenges with a blockchain-based platform where:  

• Encrypted inputs are submitted and stored immutably on-chain  
• Multi-party encrypted data contributes to collaborative model training without plaintext exposure  
• Predictions and recommendations are generated on encrypted data, returned as encrypted results  
• Access control and optional differential privacy safeguards ensure data protection and fairness  

## Features

### Core Functionality

• Encrypted Participant Submission: Patients submit encrypted health records or features  
• Encrypted Model Training: Multiple researchers contribute encrypted model updates without sharing plaintext  
• Secure Aggregation: Encrypted model updates are aggregated homomorphically on-chain  
• Encrypted Inference: Predictions are generated directly on encrypted data  
• Privacy-Preserving Results: Output is returned as ciphertext, never exposing raw predictions  

### Privacy & Security

• Fully Homomorphic Encryption: All computations occur on ciphertexts  
• Multi-Party Secure Collaboration: Data contributors never expose raw inputs  
• Differential Privacy Hooks: Aggregators can add encrypted noise to enhance privacy guarantees  
• Fine-Grained Access Control: Roles for patients, researchers, and aggregators enforced by smart contract  
• Immutable Records: Data and model submissions stored transparently and verifiably on-chain  

## Architecture

### Smart Contracts

ConfidentialClinicalTrialMatchingFHE.sol (deployed on Ethereum)  

• Manages encrypted participant data submissions  
• Accepts encrypted model updates from researchers  
• Aggregates encrypted weights and supports encrypted inference  
• Provides role-based access control and differential privacy configuration  
• Handles decryption requests through FHE service callbacks with proof verification  

### Frontend Application

• React + TypeScript: User interface for patients and researchers  
• Ethers.js: Smart contract interactions  
• Role-based UI: Different views for patients, researchers, and aggregators  
• Privacy Dashboard: Displays encrypted model status and DP configurations  
• Wallet Integration: MetaMask / WalletConnect support  

## Technology Stack

### Blockchain

• Solidity ^0.8.24: Smart contract development  
• FHE VM (Zama): Fully Homomorphic Encryption support  
• Hardhat: Development and testing framework  
• Ethereum Sepolia Testnet: Deployment network  

### Frontend

• React 18 + TypeScript: Modern frontend framework  
• Ethers.js: Ethereum blockchain integration  
• Tailwind + CSS: Responsive and clean design  
• Vercel: Frontend hosting platform  

## Installation

### Prerequisites

• Node.js 18+  
• npm / yarn / pnpm package manager  
• Ethereum wallet (MetaMask, WalletConnect, etc.)  

### Setup

1. Install dependencies  
   npm install  

2. Compile contracts  
   npx hardhat compile  

3. Deploy to Sepolia (configure hardhat.config.js first)  
   npx hardhat run deploy/deploy.ts --network sepolia  

4. Start frontend server  
   cd frontend  
   npm install  
   npm run dev  

## Usage

• Submit Encrypted Data: Patients upload encrypted records via frontend  
• Model Contribution: Researchers submit encrypted model updates  
• Aggregation: Aggregators homomorphically combine model updates  
• Encrypted Inference: Researchers run encrypted predictions on new patient data  
• Decryption Requests: Authorized users request selective decryption with proof verification  

## Security Features

• End-to-End Encryption: Data always encrypted from submission to computation  
• Immutable Ledger: On-chain records cannot be altered retroactively  
• Differential Privacy: Optional DP noise added to protect against re-identification attacks  
• Role-Based Access: Admin, researcher, and aggregator roles strictly enforced  
• Verifiable Decryption: FHE provider signatures and proofs checked on-chain  

## Future Enhancements

• Support for larger-scale encrypted models and multi-layer neural networks  
• Integration with IPFS/Arweave for large ciphertext storage and on-chain references  
• DAO governance for differential privacy and model release policies  
• Advanced analytics and privacy-preserving dashboards  
• Multi-chain deployment for global accessibility  

Built with ❤️ to advance secure, collaborative, and privacy-preserving clinical research.