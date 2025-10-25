// ============================================
// BLOCKCHAIN EVENT LISTENER SERVICE
// Indexes events from smart contract to MongoDB
// ============================================

require("dotenv").config();
const { ethers } = require("ethers");
const mongoose = require("mongoose");

// Import schemas (or define them here)
const electionSchema = new mongoose.Schema({
  electionId: String,
  title: String,
  description: String,
  startTime: Number,
  endTime: Number,
  status: String,
  finalized: Boolean,
  transactionHash: String,
  blockNumber: Number,
  createdAt: Date,
});

const candidateSchema = new mongoose.Schema({
  candidateId: String,
  electionId: String,
  name: String,
  transactionHash: String,
  blockNumber: Number,
  createdAt: Date,
});

const voteSchema = new mongoose.Schema({
  electionId: String,
  candidateId: String,
  voterAddress: String,
  timestamp: Number,
  transactionHash: String,
  blockNumber: Number,
  votedAt: Date,
});

const Election = mongoose.model("Election", electionSchema);
const Candidate = mongoose.model("Candidate", candidateSchema);
const Vote = mongoose.model("Vote", voteSchema);

// Configuration
const CONFIG = {
  RPC_URL: process.env.RPC_URL || "https://rpc.sepolia.org",
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,
  MONGODB_URI:
    process.env.MONGODB_URI || "mongodb://localhost:27017/voting_system",
  START_BLOCK: parseInt(process.env.START_BLOCK || "0"),
};

const CONTRACT_ABI = [
  "event ElectionCreated(uint256 indexed electionId, uint256 startTime, uint256 endTime, string title, string description)",
  "event CandidateAdded(uint256 indexed electionId, uint256 indexed candidateId, string name)",
  "event VoteCast(uint256 indexed electionId, address indexed voter, uint256 indexed candidateId, uint256 timestamp)",
  "event VoterRegistered(address indexed voter, uint256 timestamp)",
  "event ElectionFinalized(uint256 indexed electionId, uint256 timestamp)",
];

let provider;
let contract;
let lastProcessedBlock = CONFIG.START_BLOCK;

// ============================================
// INITIALIZE CONNECTIONS
// ============================================
async function connectProvider() {
  try {
    provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    await provider.getBlockNumber(); // test the connection
    console.log("✅ Connected to blockchain provider");
    return provider;
  } catch (err) {
    console.error(`❌ RPC connection failed (${CONFIG.RPC_URL}):`, err.message);
    console.log("⏳ Retrying in 5s...");
    await new Promise((r) => setTimeout(r, 5000));
    return connectProvider();
  }
}

async function init() {
  try {
    // Connect to blockchain
    // provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    provider = await connectProvider();
    contract = new ethers.Contract(
      CONFIG.CONTRACT_ADDRESS,
      CONTRACT_ABI,
      provider
    );

    console.log("✅ Connected to blockchain");
    console.log(`   Contract: ${CONFIG.CONTRACT_ADDRESS}`);
    console.log(`   Network: ${(await provider.getNetwork()).name}`);

    // Connect to MongoDB
    await mongoose.connect(CONFIG.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Get last processed block from database
    const lastBlock = await getLastProcessedBlock();
    if (lastBlock > lastProcessedBlock) {
      lastProcessedBlock = lastBlock;
    }
    console.log(`   Starting from block: ${lastProcessedBlock}`);
  } catch (error) {
    console.error("❌ Initialization failed:", error);
    process.exit(1);
  }
}

// ============================================
// BLOCK TRACKING
// ============================================

const BlockTracker = mongoose.model(
  "BlockTracker",
  new mongoose.Schema({
    serviceName: { type: String, default: "event-listener" },
    lastBlock: Number,
    updatedAt: { type: Date, default: Date.now },
  })
);

async function getLastProcessedBlock() {
  const tracker = await BlockTracker.findOne({ serviceName: "event-listener" });
  return tracker ? tracker.lastBlock : CONFIG.START_BLOCK;
}

async function updateLastProcessedBlock(blockNumber) {
  await BlockTracker.findOneAndUpdate(
    { serviceName: "event-listener" },
    { lastBlock: blockNumber, updatedAt: new Date() },
    { upsert: true }
  );
}

// ============================================
// EVENT HANDLERS
// ============================================

async function handleElectionCreated(event) {
  const { electionId, startTime, endTime, title, description } = event.args;

  console.log(`📊 Election Created: "${title}" (ID: ${electionId})`);

  try {
    await Election.findOneAndUpdate(
      { electionId: electionId.toString() },
      {
        electionId: electionId.toString(),
        title,
        description,
        startTime: parseInt(startTime.toString()),
        endTime: parseInt(endTime.toString()),
        status: "Pending",
        finalized: false,
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        createdAt: new Date(),
      },
      { upsert: true, new: true }
    );

    console.log(`   ✓ Saved to database`);
  } catch (error) {
    console.error(`   ✗ Error saving election:`, error.message);
  }
}

async function handleCandidateAdded(event) {
  const { electionId, candidateId, name } = event.args;

  console.log(
    `👤 Candidate Added: "${name}" (ID: ${candidateId}) to Election ${electionId}`
  );

  try {
    await Candidate.findOneAndUpdate(
      {
        electionId: electionId.toString(),
        candidateId: candidateId.toString(),
      },
      {
        electionId: electionId.toString(),
        candidateId: candidateId.toString(),
        name,
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        createdAt: new Date(),
      },
      { upsert: true, new: true }
    );

    console.log(`   ✓ Saved to database`);
  } catch (error) {
    console.error(`   ✗ Error saving candidate:`, error.message);
  }
}

async function handleVoteCast(event) {
  const { electionId, voter, candidateId, timestamp } = event.args;

  console.log(
    `🗳️  Vote Cast: Election ${electionId}, Candidate ${candidateId} by ${voter.slice(
      0,
      10
    )}...`
  );

  try {
    await Vote.findOneAndUpdate(
      {
        electionId: electionId.toString(),
        voterAddress: voter.toLowerCase(),
      },
      {
        electionId: electionId.toString(),
        candidateId: candidateId.toString(),
        voterAddress: voter.toLowerCase(),
        timestamp: parseInt(timestamp.toString()),
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        votedAt: new Date(parseInt(timestamp.toString()) * 1000),
      },
      { upsert: true, new: true }
    );

    console.log(`   ✓ Saved to database`);
  } catch (error) {
    console.error(`   ✗ Error saving vote:`, error.message);
  }
}

async function handleElectionFinalized(event) {
  const { electionId } = event.args;

  console.log(`🏁 Election Finalized: ${electionId}`);

  try {
    await Election.findOneAndUpdate(
      { electionId: electionId.toString() },
      {
        status: "Finalized",
        finalized: true,
        finalizedAt: new Date(),
      }
    );

    console.log(`   ✓ Updated in database`);
  } catch (error) {
    console.error(`   ✗ Error updating election:`, error.message);
  }
}

async function handleVoterRegistered(event) {
  const { voter } = event.args;
  console.log(`✅ Voter Registered: ${voter}`);
  // Optional: Track registered voters if needed
}

// ============================================
// HISTORICAL EVENT PROCESSING
// ============================================

async function processHistoricalEvents() {
  const currentBlock = await provider.getBlockNumber();

  if (lastProcessedBlock >= currentBlock) {
    console.log("✓ Already up to date");
    return;
  }

  console.log(`\n📜 Processing historical events...`);
  console.log(`   From block: ${lastProcessedBlock}`);
  console.log(`   To block: ${currentBlock}`);
  console.log(`   Total blocks to scan: ${currentBlock - lastProcessedBlock}`);

  const BATCH_SIZE = 5000; // Process in batches to avoid RPC limits

  for (
    let fromBlock = lastProcessedBlock;
    fromBlock < currentBlock;
    fromBlock += BATCH_SIZE
  ) {
    const toBlock = Math.min(fromBlock + BATCH_SIZE - 1, currentBlock);

    console.log(`\n   Scanning blocks ${fromBlock} to ${toBlock}...`);

    try {
      // Get all events in this range
      const filter = {
        address: CONFIG.CONTRACT_ADDRESS,
        fromBlock,
        toBlock,
      };

      const logs = await provider.getLogs(filter);

      console.log(`   Found ${logs.length} events`);

      // Process each log
      for (const log of logs) {
        try {
          const parsedLog = contract.interface.parseLog(log);
          const event = {
            ...parsedLog,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
          };

          // Route to appropriate handler
          switch (event.name) {
            case "ElectionCreated":
              await handleElectionCreated(event);
              break;
            case "CandidateAdded":
              await handleCandidateAdded(event);
              break;
            case "VoteCast":
              await handleVoteCast(event);
              break;
            case "ElectionFinalized":
              await handleElectionFinalized(event);
              break;
            case "VoterRegistered":
              await handleVoterRegistered(event);
              break;
          }
        } catch (parseError) {
          // Not our contract's event, skip
          continue;
        }
      }

      // Update last processed block
      await updateLastProcessedBlock(toBlock);
      lastProcessedBlock = toBlock;
    } catch (error) {
      console.error(
        `   ✗ Error processing blocks ${fromBlock}-${toBlock}:`,
        error.message
      );
      // Continue with next batch
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`\n✅ Historical sync complete!`);
}

// ============================================
// REAL-TIME EVENT LISTENING
// ============================================

function startRealTimeListening() {
  console.log(`\n🎧 Starting real-time event listener...`);

  // Listen for ElectionCreated events
  contract.on(
    "ElectionCreated",
    async (electionId, startTime, endTime, title, description, event) => {
      await handleElectionCreated({
        args: { electionId, startTime, endTime, title, description },
        transactionHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
      await updateLastProcessedBlock(event.log.blockNumber);
    }
  );

  // Listen for CandidateAdded events
  contract.on(
    "CandidateAdded",
    async (electionId, candidateId, name, event) => {
      await handleCandidateAdded({
        args: { electionId, candidateId, name },
        transactionHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
      await updateLastProcessedBlock(event.log.blockNumber);
    }
  );

  // Listen for VoteCast events
  contract.on(
    "VoteCast",
    async (electionId, voter, candidateId, timestamp, event) => {
      await handleVoteCast({
        args: { electionId, voter, candidateId, timestamp },
        transactionHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
      await updateLastProcessedBlock(event.log.blockNumber);
    }
  );

  // Listen for ElectionFinalized events
  contract.on("ElectionFinalized", async (electionId, timestamp, event) => {
    await handleElectionFinalized({
      args: { electionId, timestamp },
      transactionHash: event.log.transactionHash,
      blockNumber: event.log.blockNumber,
    });
    await updateLastProcessedBlock(event.log.blockNumber);
  });

  // Listen for VoterRegistered events
  contract.on("VoterRegistered", async (voter, timestamp, event) => {
    await handleVoterRegistered({
      args: { voter, timestamp },
      transactionHash: event.log.transactionHash,
      blockNumber: event.log.blockNumber,
    });
  });

  console.log(`✅ Real-time listeners active`);
  console.log(`   Monitoring contract: ${CONFIG.CONTRACT_ADDRESS}`);
}

// ============================================
// STATISTICS
// ============================================

async function printStatistics() {
  const electionsCount = await Election.countDocuments();
  const candidatesCount = await Candidate.countDocuments();
  const votesCount = await Vote.countDocuments();

  console.log(`\n📊 Database Statistics:`);
  console.log(`   Elections: ${electionsCount}`);
  console.log(`   Candidates: ${candidatesCount}`);
  console.log(`   Votes: ${votesCount}`);
  console.log(`   Last Processed Block: ${lastProcessedBlock}`);
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
  console.log(`
╔════════════════════════════════════════╗
║     BLOCKCHAIN EVENT LISTENER          ║
╠════════════════════════════════════════╣
║  Indexing events to MongoDB            ║
╚════════════════════════════════════════╝
  `);

  await init();

  // Process historical events first
  await processHistoricalEvents();

  // Print current stats
  await printStatistics();

  // Start listening for new events
  startRealTimeListening();

  // Periodic health check
  setInterval(async () => {
    const currentBlock = await provider.getBlockNumber();
    console.log(
      `\n💓 Health Check - Current Block: ${currentBlock}, Last Processed: ${lastProcessedBlock}`
    );
    await printStatistics();
  }, 60000); // Every minute
}

// ============================================
// START SERVICE
// ============================================

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("\n👋 Shutting down gracefully...");
  await mongoose.connection.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("\n👋 Shutting down gracefully...");
  await mongoose.connection.close();
  process.exit(0);
});
