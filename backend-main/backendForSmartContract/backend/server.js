// ============================================
// BLOCKCHAIN BACKEND SERVICE (MongoDB Version)
// Handles all smart contract interactions
// ============================================

require("dotenv").config();
const express = require("express");
const { ethers } = require("ethers");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(express.json());
app.use(cors());

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  RPC_URL: process.env.RPC_URL || "https://rpc.sepolia.org",
  CONTRACT_ADDRESS:
    process.env.CONTRACT_ADDRESS ||
    "0x8Ca7462f52F34B8ebfCEf311052E3b14128B0dc9",
  ADMIN_PRIVATE_KEY: process.env.ADMIN_PRIVATE_KEY,
  CHAIN_ID: parseInt(process.env.CHAIN_ID || "11155111"),
  PORT: process.env.PORT || 3001,
  MONGODB_URI:
    process.env.MONGODB_URI || "mongodb://localhost:27017/voting_system",
};

// ============================================
// MONGODB SCHEMAS
// ============================================

const userWalletSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  walletAddress: { type: String, required: true, unique: true },
  encryptedPrivateKey: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const electionSchema = new mongoose.Schema({
  electionId: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true },
  description: String,
  startTime: { type: Number, required: true },
  endTime: { type: Number, required: true },
  status: {
    type: String,
    enum: ["Pending", "Active", "Ended", "Finalized"],
    default: "Pending",
  },
  finalized: { type: Boolean, default: false },
  finalizedAt: Date,
  transactionHash: String,
  createdAt: { type: Date, default: Date.now },
});

const candidateSchema = new mongoose.Schema({
  candidateId: { type: String, required: true, index: true },
  electionId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  description: String,
  imageUrl: String,
  transactionHash: String,
  createdAt: { type: Date, default: Date.now },
});

candidateSchema.index({ electionId: 1, candidateId: 1 }, { unique: true });

const voteSchema = new mongoose.Schema({
  electionId: { type: String, required: true, index: true },
  candidateId: { type: String, required: true, index: true },
  voterAddress: { type: String, required: true, index: true },
  userId: String,
  timestamp: { type: Number, required: true },
  transactionHash: { type: String, required: true, unique: true },
  blockNumber: Number,
  votedAt: { type: Date, default: Date.now },
});

voteSchema.index({ electionId: 1, voterAddress: 1 }, { unique: true });

// Models
const UserWallet = mongoose.model("UserWallet", userWalletSchema);
const Election = mongoose.model("Election", electionSchema);
const Candidate = mongoose.model("Candidate", candidateSchema);
const Vote = mongoose.model("Vote", voteSchema);

// ============================================
// CONTRACT ABI
// ============================================

const CONTRACT_ABI = [
  "function registerVoter(address _voter) external",
  "function createElection(string calldata _title, string calldata _description, uint256 _durationMinutes, uint256 _startDelayMinutes) external returns (uint256)",
  "function addCandidate(uint256 _electionId, string calldata _name) external",
  "function vote(uint256 _electionId, uint256 _candidateId) external",
  "function finalizeElection(uint256 _electionId) external",
  "function getElectionStatus(uint256 _electionId) external view returns (string memory)",
  "function hasVoterVoted(uint256 _electionId, address _voter) external view returns (bool)",
  "function getCandidateCount(uint256 _electionId) external view returns (uint256)",
  "function isRegistered(address) external view returns (bool)",
  "function elections(uint256) external view returns (uint256 startTime, uint256 endTime, bool finalized, bool exists)",
  "event ElectionCreated(uint256 indexed electionId, uint256 startTime, uint256 endTime, string title, string description)",
  "event CandidateAdded(uint256 indexed electionId, uint256 indexed candidateId, string name)",
  "event VoteCast(uint256 indexed electionId, address indexed voter, uint256 indexed candidateId, uint256 timestamp)",
  "event VoterRegistered(address indexed voter, uint256 timestamp)",
  "event ElectionFinalized(uint256 indexed electionId, uint256 timestamp)",
];

// ============================================
// BLOCKCHAIN CONNECTION
// ============================================

let provider;
let adminWallet;
let contract;
let adminContract;

function initBlockchain() {
  try {
    provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);

    if (CONFIG.ADMIN_PRIVATE_KEY) {
      adminWallet = new ethers.Wallet(CONFIG.ADMIN_PRIVATE_KEY, provider);
      adminContract = new ethers.Contract(
        CONFIG.CONTRACT_ADDRESS,
        CONTRACT_ABI,
        adminWallet
      );
      console.log("✅ Admin wallet connected:", adminWallet.address);
    }

    contract = new ethers.Contract(
      CONFIG.CONTRACT_ADDRESS,
      CONTRACT_ABI,
      provider
    );
    console.log("✅ Connected to contract:", CONFIG.CONTRACT_ADDRESS);
  } catch (error) {
    console.error("❌ Blockchain initialization failed:", error);
    process.exit(1);
  }
}

// ============================================
// DATABASE CONNECTION
// ============================================

async function connectMongoDB() {
  try {
    await mongoose.connect(CONFIG.MONGODB_URI);
    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
}

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.log("⚠️ MongoDB disconnected");
});

// ============================================
// IN-MEMORY CACHE (Simple Alternative to Redis)
// ============================================

const cache = new Map();

function getFromCache(key) {
  const item = cache.get(key);
  if (!item) return null;

  // Check if expired
  if (Date.now() > item.expiry) {
    cache.delete(key);
    return null;
  }

  return item.value;
}

function setCache(key, value, ttlSeconds = 300) {
  cache.set(key, {
    value,
    expiry: Date.now() + ttlSeconds * 1000,
  });
}

function deleteCache(key) {
  cache.delete(key);
}

// Clear expired cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of cache.entries()) {
    if (now > item.expiry) {
      cache.delete(key);
    }
  }
}, 60000); // Clean up every minute

// ============================================
// HELPER FUNCTIONS
// ============================================

// Wallet management helper
async function getOrCreateUserWallet(userId) {
  try {
    // Check if wallet exists in DB
    let userWallet = await UserWallet.findOne({ userId });

    if (userWallet) {
      // Decrypt and return existing wallet
      const privateKey = decryptPrivateKey(userWallet.encryptedPrivateKey);
      const wallet = new ethers.Wallet(privateKey, provider);
      return wallet;
    }

    // Create new wallet
    const wallet = ethers.Wallet.createRandom().connect(provider);

    // Encrypt private key before storing
    const encryptedKey = encryptPrivateKey(wallet.privateKey);

    userWallet = await UserWallet.create({
      userId,
      walletAddress: wallet.address,
      encryptedPrivateKey: encryptedKey,
    });

    return wallet;
  } catch (error) {
    console.error("Wallet creation error:", error);
    throw error;
  }
}

// Simple encryption (USE PROPER ENCRYPTION IN PRODUCTION!)
function encryptPrivateKey(privateKey) {
  // TODO: Implement proper encryption with AWS KMS or similar
  const crypto = require("crypto");
  const algorithm = "aes-256-cbc";
  const key = Buffer.from(process.env.ENCRYPTION_KEY || "0".repeat(64), "hex");
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(privateKey, "utf8", "hex");
  encrypted += cipher.final("hex");

  return iv.toString("hex") + ":" + encrypted;
}

function decryptPrivateKey(encryptedKey) {
  const crypto = require("crypto");
  const algorithm = "aes-256-cbc";
  const key = Buffer.from(process.env.ENCRYPTION_KEY || "0".repeat(64), "hex");

  const parts = encryptedKey.split(":");
  const iv = Buffer.from(parts[0], "hex");
  const encrypted = parts[1];

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

// ============================================
// ADMIN ENDPOINTS (Contract Interactions)
// ============================================

// Create Election
app.post("/api/admin/elections/create", async (req, res) => {
  try {
    const { title, description, durationMinutes, startDelayMinutes } = req.body;

    // Validate input
    if (!title || !durationMinutes) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    console.log("Creating election:", title);

    // Call smart contract
    const tx = await adminContract.createElection(
      title,
      description || "",
      durationMinutes,
      startDelayMinutes || 0
    );

    console.log("Transaction sent:", tx.hash);

    // Wait for confirmation
    const receipt = await tx.wait();

    // Parse event to get election ID
    const event = receipt.logs.find((log) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed.name === "ElectionCreated";
      } catch (e) {
        return false;
      }
    });

    const parsedEvent = contract.interface.parseLog(event);
    const electionId = parsedEvent.args.electionId.toString();
    const startTime = parsedEvent.args.startTime.toString();
    const endTime = parsedEvent.args.endTime.toString();

    // Store in MongoDB
    await Election.create({
      electionId,
      title,
      description: description || "",
      startTime: parseInt(startTime),
      endTime: parseInt(endTime),
      status: "Pending",
      transactionHash: tx.hash,
    });

    console.log("✅ Election created:", electionId);

    res.json({
      success: true,
      electionId: electionId,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
  } catch (error) {
    console.error("Create election error:", error);
    res.status(500).json({
      error: "Failed to create election",
      message: error.message,
    });
  }
});

// Add Candidate
app.post("/api/admin/elections/:electionId/candidates", async (req, res) => {
  try {
    const { electionId } = req.params;
    const { name, description, imageUrl } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Candidate name required" });
    }

    console.log(`Adding candidate "${name}" to election ${electionId}`);

    const tx = await adminContract.addCandidate(electionId, name);
    const receipt = await tx.wait();

    // Parse candidate ID from event
    const event = receipt.logs.find((log) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed.name === "CandidateAdded";
      } catch (e) {
        return false;
      }
    });

    const parsedEvent = contract.interface.parseLog(event);
    const candidateId = parsedEvent.args.candidateId.toString();

    // Store in MongoDB
    await Candidate.create({
      candidateId,
      electionId,
      name,
      description,
      imageUrl,
      transactionHash: tx.hash,
    });

    // Clear cache
    deleteCache(`election:${electionId}:candidates`);

    console.log("✅ Candidate added:", candidateId);

    res.json({
      success: true,
      candidateId: candidateId,
      transactionHash: tx.hash,
    });
  } catch (error) {
    console.error("Add candidate error:", error);
    res.status(500).json({
      error: "Failed to add candidate",
      message: error.message,
    });
  }
});

// Register Voter
app.post("/api/admin/voters/register", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID required" });
    }

    // Get or create wallet for user
    const wallet = await getOrCreateUserWallet(userId);

    console.log(`Registering voter: ${wallet.address} for user ${userId}`);

    // Check if already registered
    const isRegistered = await contract.isRegistered(wallet.address);
    if (isRegistered) {
      return res.json({
        success: true,
        message: "Voter already registered",
        walletAddress: wallet.address,
      });
    }

    // Register on blockchain
    const tx = await adminContract.registerVoter(wallet.address);
    const receipt = await tx.wait();

    console.log("✅ Voter registered:", wallet.address);

    res.json({
      success: true,
      walletAddress: wallet.address,
      transactionHash: tx.hash,
    });
  } catch (error) {
    console.error("Register voter error:", error);
    res.status(500).json({
      error: "Failed to register voter",
      message: error.message,
    });
  }
});

// Finalize Election
app.post("/api/admin/elections/:electionId/finalize", async (req, res) => {
  try {
    const { electionId } = req.params;

    console.log(`Finalizing election ${electionId}`);

    const tx = await adminContract.finalizeElection(electionId);
    const receipt = await tx.wait();

    // Update MongoDB
    await Election.findOneAndUpdate(
      { electionId },
      {
        status: "Finalized",
        finalized: true,
        finalizedAt: new Date(),
      }
    );

    // Clear cache
    deleteCache(`election:${electionId}:status`);
    deleteCache(`election:${electionId}:results`);

    console.log("✅ Election finalized");

    res.json({
      success: true,
      transactionHash: tx.hash,
    });
  } catch (error) {
    console.error("Finalize election error:", error);
    res.status(500).json({
      error: "Failed to finalize election",
      message: error.message,
    });
  }
});

// ============================================
// USER ENDPOINTS (Voting)
// ============================================

// Cast Vote (User endpoint)
app.post("/api/vote", async (req, res) => {
  try {
    const { userId, electionId, candidateId } = req.body;

    if (!userId || !electionId || !candidateId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Get user's wallet
    const wallet = await getOrCreateUserWallet(userId);

    console.log(
      `User ${userId} (${wallet.address}) voting for candidate ${candidateId} in election ${electionId}`
    );

    // Check if already voted
    const hasVoted = await contract.hasVoterVoted(electionId, wallet.address);
    if (hasVoted) {
      return res
        .status(400)
        .json({ error: "You have already voted in this election" });
    }

    // Create contract instance with user's wallet
    const userContract = new ethers.Contract(
      CONFIG.CONTRACT_ADDRESS,
      CONTRACT_ABI,
      wallet
    );

    // Submit vote transaction
    const tx = await userContract.vote(electionId, candidateId);
    console.log("Vote transaction sent:", tx.hash);

    const receipt = await tx.wait();

    // Parse vote event for timestamp
    const event = receipt.logs.find((log) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed.name === "VoteCast";
      } catch (e) {
        return false;
      }
    });

    const parsedEvent = contract.interface.parseLog(event);
    const timestamp = parsedEvent.args.timestamp.toString();

    // Store vote in MongoDB
    await Vote.create({
      electionId,
      candidateId,
      voterAddress: wallet.address,
      userId,
      timestamp: parseInt(timestamp),
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });

    console.log("✅ Vote confirmed");

    // Clear relevant caches
    deleteCache(`election:${electionId}:results`);

    res.json({
      success: true,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
  } catch (error) {
    console.error("Vote error:", error);
    res.status(500).json({
      error: "Failed to cast vote",
      message: error.message,
    });
  }
});

// ============================================
// QUERY ENDPOINTS (Read-only)
// ============================================

// Get Election Status
app.get("/api/elections/:electionId/status", async (req, res) => {
  try {
    const { electionId } = req.params;

    // Check cache
    const cacheKey = `election:${electionId}:status`;
    const cached = getFromCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const status = await contract.getElectionStatus(electionId);
    const electionData = await contract.elections(electionId);

    const response = {
      electionId,
      status,
      startTime: electionData.startTime.toString(),
      endTime: electionData.endTime.toString(),
      finalized: electionData.finalized,
    };

    // Cache for 30 seconds
    setCache(cacheKey, response, 30);

    res.json(response);
  } catch (error) {
    console.error("Get status error:", error);
    res.status(500).json({
      error: "Failed to get election status",
      message: error.message,
    });
  }
});

// Get Election Details with Candidates
app.get("/api/elections/:electionId", async (req, res) => {
  try {
    const { electionId } = req.params;

    // Get election from MongoDB
    const election = await Election.findOne({ electionId }).lean();

    if (!election) {
      return res.status(404).json({ error: "Election not found" });
    }

    // Get candidates with vote counts
    const candidates = await Candidate.find({ electionId }).lean();

    // Get vote counts for each candidate
    const candidatesWithVotes = await Promise.all(
      candidates.map(async (candidate) => {
        const voteCount = await Vote.countDocuments({
          electionId,
          candidateId: candidate.candidateId,
        });
        return {
          ...candidate,
          voteCount,
        };
      })
    );

    res.json({
      ...election,
      candidates: candidatesWithVotes,
    });
  } catch (error) {
    console.error("Get election error:", error);
    res.status(500).json({
      error: "Failed to get election",
      message: error.message,
    });
  }
});

// Get Election Results
app.get("/api/elections/:electionId/results", async (req, res) => {
  try {
    const { electionId } = req.params;

    // Check cache
    const cacheKey = `election:${electionId}:results`;
    const cached = getFromCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Get candidates
    const candidates = await Candidate.find({ electionId }).lean();

    // Get vote counts using aggregation
    const voteCounts = await Vote.aggregate([
      { $match: { electionId } },
      {
        $group: {
          _id: "$candidateId",
          voteCount: { $sum: 1 },
        },
      },
    ]);

    // Create vote count map
    const voteCountMap = {};
    voteCounts.forEach((vc) => {
      voteCountMap[vc._id] = vc.voteCount;
    });

    // Calculate total votes
    const totalVotes = voteCounts.reduce((sum, vc) => sum + vc.voteCount, 0);

    // Combine candidate data with vote counts
    const results = candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      name: candidate.name,
      description: candidate.description,
      imageUrl: candidate.imageUrl,
      voteCount: voteCountMap[candidate.candidateId] || 0,
    }));

    // Sort by vote count
    results.sort((a, b) => b.voteCount - a.voteCount);

    // Add rankings and percentages
    const resultsWithStats = results.map((result, index) => ({
      ...result,
      rank: index + 1,
      percentage:
        totalVotes > 0
          ? ((result.voteCount / totalVotes) * 100).toFixed(2)
          : "0.00",
    }));

    const response = {
      electionId,
      totalVotes,
      results: resultsWithStats,
      winner: resultsWithStats[0] || null,
    };

    // Cache results
    const status = await contract.getElectionStatus(electionId);
    const ttl = status === "Finalized" ? 86400 : 10; // 24h if finalized, 10s otherwise
    setCache(cacheKey, response, ttl);

    res.json(response);
  } catch (error) {
    console.error("Get results error:", error);
    res.status(500).json({
      error: "Failed to get results",
      message: error.message,
    });
  }
});

// Check if user has voted
app.get("/api/users/:userId/elections/:electionId/voted", async (req, res) => {
  try {
    const { userId, electionId } = req.params;

    // Get user wallet
    const userWallet = await UserWallet.findOne({ userId });

    if (!userWallet) {
      return res.json({ hasVoted: false });
    }

    const hasVoted = await contract.hasVoterVoted(
      electionId,
      userWallet.walletAddress
    );

    res.json({ hasVoted });
  } catch (error) {
    console.error("Check voted error:", error);
    res.status(500).json({
      error: "Failed to check vote status",
      message: error.message,
    });
  }
});

// Get user's voting history
app.get("/api/users/:userId/votes", async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user wallet
    const userWallet = await UserWallet.findOne({ userId });

    if (!userWallet) {
      return res.json({ votes: [] });
    }

    // Get votes with populated election and candidate info
    const votes = await Vote.find({
      voterAddress: userWallet.walletAddress,
    })
      .sort({ votedAt: -1 })
      .lean();

    // Enrich with election and candidate data
    const enrichedVotes = await Promise.all(
      votes.map(async (vote) => {
        const election = await Election.findOne({
          electionId: vote.electionId,
        }).lean();
        const candidate = await Candidate.findOne({
          electionId: vote.electionId,
          candidateId: vote.candidateId,
        }).lean();

        return {
          electionId: vote.electionId,
          electionTitle: election?.title || "Unknown",
          candidateId: vote.candidateId,
          candidateName: candidate?.name || "Unknown",
          votedAt: vote.votedAt,
          transactionHash: vote.transactionHash,
        };
      })
    );

    res.json({ votes: enrichedVotes });
  } catch (error) {
    console.error("Get vote history error:", error);
    res.status(500).json({
      error: "Failed to get vote history",
      message: error.message,
    });
  }
});

// Get all elections
app.get("/api/elections", async (req, res) => {
  try {
    const { status, limit = 20, skip = 0 } = req.query;

    const query = status ? { status } : {};

    const elections = await Election.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();

    const total = await Election.countDocuments(query);

    res.json({
      elections,
      total,
      limit: parseInt(limit),
      skip: parseInt(skip),
    });
  } catch (error) {
    console.error("Get elections error:", error);
    res.status(500).json({
      error: "Failed to get elections",
      message: error.message,
    });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get("/health", async (req, res) => {
  try {
    const blockNumber = await provider.getBlockNumber();
    const dbStatus =
      mongoose.connection.readyState === 1 ? "connected" : "disconnected";

    res.json({
      status: "healthy",
      blockNumber,
      chainId: CONFIG.CHAIN_ID,
      contractAddress: CONFIG.CONTRACT_ADDRESS,
      database: dbStatus,
      cache: `in-memory (${cache.size} items)`,
    });
  } catch (error) {
    res.status(500).json({ status: "unhealthy", error: error.message });
  }
});

// ============================================
// ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

// ============================================
// START SERVER
// ============================================

async function start() {
  try {
    // Initialize connections
    initBlockchain();
    await connectMongoDB();

    console.log("✅ Using in-memory cache (no Redis required)");

    // Start server
    app.listen(CONFIG.PORT, () => {
      console.log(`
╔════════════════════════════════════════╗
║   BLOCKCHAIN BACKEND SERVICE STARTED   ║
╠════════════════════════════════════════╣
║  Port: ${CONFIG.PORT}                        ║
║  Network: Sepolia Testnet              ║
║  Contract: ${CONFIG.CONTRACT_ADDRESS.slice(0, 10)}...  ║
║  Database: MongoDB                     ║
║  Cache: In-Memory                      ║
╚════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down gracefully...");
  await mongoose.connection.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  await mongoose.connection.close();
  process.exit(0);
});
