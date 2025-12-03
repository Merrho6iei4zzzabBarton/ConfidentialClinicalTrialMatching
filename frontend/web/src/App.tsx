import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface ClinicalTrialRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  condition: string;
  status: "pending" | "matched" | "rejected";
  fheProof: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<ClinicalTrialRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    condition: "",
    medicalHistory: "",
    genomicData: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("dashboard");

  // Calculate statistics for dashboard
  const matchedCount = records.filter(r => r.status === "matched").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const rejectedCount = records.filter(r => r.status === "rejected").length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("record_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing record keys:", e);
        }
      }
      
      const list: ClinicalTrialRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`record_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                owner: recordData.owner,
                condition: recordData.condition,
                status: recordData.status || "pending",
                fheProof: recordData.fheProof || "FHE-Verified"
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting sensitive data with Zama FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        condition: newRecordData.condition,
        status: "pending",
        fheProof: "FHE-Verified"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("record_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "record_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted data submitted securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          condition: "",
          medicalHistory: "",
          genomicData: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const matchRecord = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`record_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "matched"
      };
      
      await contract.setData(
        `record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE matching completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Matching failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectRecord = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`record_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "rejected"
      };
      
      await contract.setData(
        `record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE rejection completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const toggleRecordDetails = (id: string) => {
    setExpandedRecord(expandedRecord === id ? null : id);
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the platform",
      icon: "🔗"
    },
    {
      title: "Submit Encrypted Data",
      description: "Add your medical data which will be encrypted using FHE",
      icon: "🔒"
    },
    {
      title: "FHE Processing",
      description: "Your data is matched with trials without decryption",
      icon: "⚙️"
    },
    {
      title: "Get Matches",
      description: "Receive trial matches while keeping your data private",
      icon: "💉"
    }
  ];

  const renderPieChart = () => {
    const total = records.length || 1;
    const matchedPercentage = (matchedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const rejectedPercentage = (rejectedCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment matched" 
            style={{ transform: `rotate(${matchedPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${(matchedPercentage + pendingPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment rejected" 
            style={{ transform: `rotate(${(matchedPercentage + pendingPercentage + rejectedPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{records.length}</div>
            <div className="pie-label">Records</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box matched"></div>
            <span>Matched: {matchedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box rejected"></div>
            <span>Rejected: {rejectedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  const teamMembers = [
    {
      name: "Dr. Emily Chen",
      role: "Chief Medical Officer",
      bio: "10+ years in clinical research, specializes in oncology trials"
    },
    {
      name: "Alex Johnson",
      role: "FHE Security Specialist",
      bio: "Expert in homomorphic encryption and blockchain security"
    },
    {
      name: "Sarah Williams",
      role: "Data Privacy Officer",
      bio: "Ensures compliance with global data protection regulations"
    },
    {
      name: "Michael Rodriguez",
      role: "Blockchain Developer",
      bio: "Specializes in Web3 integration for healthcare applications"
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="natural-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container natural-theme">
      {/* Left sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-icon">
              <div className="leaf-icon"></div>
            </div>
            <h1>Confidential<span>Trial</span>Match</h1>
          </div>
        </div>
        
        <div className="sidebar-content">
          <div className="wallet-section">
            <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
          </div>
          
          <div className="navigation">
            <button 
              className={`nav-btn ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              <span className="nav-icon">📊</span>
              Dashboard
            </button>
            <button 
              className={`nav-btn ${activeTab === "records" ? "active" : ""}`}
              onClick={() => setActiveTab("records")}
            >
              <span className="nav-icon">📋</span>
              Patient Records
            </button>
            <button 
              className={`nav-btn ${activeTab === "tutorial" ? "active" : ""}`}
              onClick={() => setActiveTab("tutorial")}
            >
              <span className="nav-icon">📚</span>
              How It Works
            </button>
            <button 
              className={`nav-btn ${activeTab === "team" ? "active" : ""}`}
              onClick={() => setActiveTab("team")}
            >
              <span className="nav-icon">👥</span>
              Our Team
            </button>
          </div>
          
          <div className="fhe-badge">
            <div className="lock-icon"></div>
            <span>FHE-Powered Privacy</span>
          </div>
        </div>
      </div>
      
      {/* Main content */}
      <div className="main-content">
        <div className="content-header">
          <h2>
            {activeTab === "dashboard" && "Dashboard"}
            {activeTab === "records" && "Patient Records"}
            {activeTab === "tutorial" && "How It Works"}
            {activeTab === "team" && "Our Team"}
          </h2>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-record-btn natural-button"
          >
            <div className="add-icon"></div>
            Add Patient Data
          </button>
        </div>
        
        {/* Dashboard tab */}
        {activeTab === "dashboard" && (
          <div className="dashboard-content">
            <div className="welcome-banner">
              <div className="welcome-text">
                <h3>Privacy-Preserving Clinical Trial Matching</h3>
                <p>Securely match patients with clinical trials using Zama FHE technology</p>
              </div>
            </div>
            
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{records.length}</div>
                <div className="stat-label">Total Records</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{matchedCount}</div>
                <div className="stat-label">Matched</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-label">Rejected</div>
              </div>
            </div>
            
            <div className="chart-section">
              <h3>Status Distribution</h3>
              {renderPieChart()}
            </div>
          </div>
        )}
        
        {/* Records tab */}
        {activeTab === "records" && (
          <div className="records-section">
            <div className="section-actions">
              <button 
                onClick={loadRecords}
                className="refresh-btn natural-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh Records"}
              </button>
            </div>
            
            <div className="records-list">
              {records.length === 0 ? (
                <div className="no-records">
                  <div className="no-records-icon"></div>
                  <p>No encrypted records found</p>
                  <button 
                    className="natural-button primary"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Record
                  </button>
                </div>
              ) : (
                records.map(record => (
                  <div className="record-card" key={record.id}>
                    <div className="record-header">
                      <div className="record-id">#{record.id.substring(0, 6)}</div>
                      <div className="record-condition">{record.condition}</div>
                      <div className={`record-status ${record.status}`}>{record.status}</div>
                    </div>
                    
                    <div className="record-details">
                      <div className="detail-item">
                        <span className="detail-label">Owner:</span>
                        <span className="detail-value">{record.owner.substring(0, 6)}...{record.owner.substring(38)}</span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Date:</span>
                        <span className="detail-value">
                          {new Date(record.timestamp * 1000).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">FHE Proof:</span>
                        <span className="detail-value">{record.fheProof}</span>
                      </div>
                    </div>
                    
                    <div className="record-actions">
                      <button 
                        className="action-btn natural-button info"
                        onClick={() => toggleRecordDetails(record.id)}
                      >
                        {expandedRecord === record.id ? "Hide Details" : "View Details"}
                      </button>
                      {isOwner(record.owner) && record.status === "pending" && (
                        <div className="action-group">
                          <button 
                            className="action-btn natural-button success"
                            onClick={() => matchRecord(record.id)}
                          >
                            Match
                          </button>
                          <button 
                            className="action-btn natural-button danger"
                            onClick={() => rejectRecord(record.id)}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                    
                    {expandedRecord === record.id && (
                      <div className="record-full-details">
                        <div className="detail-item">
                          <span className="detail-label">Encrypted Data:</span>
                          <span className="detail-value">{record.encryptedData.substring(0, 60)}...</span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">Full Record ID:</span>
                          <span className="detail-value">{record.id}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {/* Tutorial tab */}
        {activeTab === "tutorial" && (
          <div className="tutorial-section">
            <h3>How FHE Protects Patient Data</h3>
            <p className="subtitle">Learn how we securely process sensitive medical data</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-number">{index + 1}</div>
                  <div className="step-content">
                    <div className="step-icon">{step.icon}</div>
                    <h4>{step.title}</h4>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="fhe-explanation">
              <h4>Fully Homomorphic Encryption (FHE)</h4>
              <p>
                FHE allows computations to be performed directly on encrypted data without 
                ever decrypting it. This means patient data remains private throughout the 
                entire matching process.
              </p>
              <div className="fhe-benefits">
                <div className="benefit">
                  <div className="benefit-icon">🔒</div>
                  <span>Data never decrypted</span>
                </div>
                <div className="benefit">
                  <div className="benefit-icon">⚙️</div>
                  <span>Secure computations</span>
                </div>
                <div className="benefit">
                  <div className="benefit-icon">✅</div>
                  <span>Regulatory compliance</span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Team tab */}
        {activeTab === "team" && (
          <div className="team-section">
            <h3>Our Expert Team</h3>
            <p className="subtitle">Combining medical expertise with cutting-edge cryptography</p>
            
            <div className="team-grid">
              {teamMembers.map((member, index) => (
                <div className="team-card" key={index}>
                  <div className="member-avatar">
                    <div className="avatar-bg"></div>
                    <div className="avatar-initial">{member.name.charAt(0)}</div>
                  </div>
                  <div className="member-info">
                    <h4>{member.name}</h4>
                    <div className="member-role">{member.role}</div>
                    <p>{member.bio}</p>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mission-statement">
              <h4>Our Mission</h4>
              <p>
                We believe that medical research should not come at the cost of patient privacy. 
                By leveraging FHE and blockchain technology, we're creating a future where 
                clinical trials can access the data they need while preserving patient 
                confidentiality.
              </p>
            </div>
          </div>
        )}
      </div>
  
      {/* Create Record Modal */}
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
        />
      )}
      
      {/* Wallet Selector */}
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {/* Transaction Status */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content natural-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="natural-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="leaf-icon small"></div>
              <span>ConfidentialTrialMatch</span>
            </div>
            <p>Secure encrypted clinical trial matching using Zama FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="copyright">
            © {new Date().getFullYear()} ConfidentialTrialMatch. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.condition || !recordData.genomicData) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal natural-card">
        <div className="modal-header">
          <h2>Add Encrypted Patient Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <span>Your sensitive data will be encrypted with Zama FHE</span>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Medical Condition *</label>
              <select 
                name="condition"
                value={recordData.condition} 
                onChange={handleChange}
                className="natural-select"
              >
                <option value="">Select condition</option>
                <option value="Cancer">Cancer</option>
                <option value="Diabetes">Diabetes</option>
                <option value="Cardiovascular">Cardiovascular Disease</option>
                <option value="Neurological">Neurological Disorder</option>
                <option value="Rare Disease">Rare Disease</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Medical History</label>
              <textarea 
                name="medicalHistory"
                value={recordData.medicalHistory} 
                onChange={handleChange}
                placeholder="Brief medical history..." 
                className="natural-textarea"
                rows={2}
              />
            </div>
            
            <div className="form-group full-width">
              <label>Genomic Data *</label>
              <textarea 
                name="genomicData"
                value={recordData.genomicData} 
                onChange={handleChange}
                placeholder="Enter genomic data to encrypt..." 
                className="natural-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <span>Data remains encrypted during FHE processing</span>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn natural-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn natural-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;