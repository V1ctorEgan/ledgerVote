const mongoose = require("mongoose");

async function setupIndexes() {
  await mongoose.connect(
    "mongodb+srv://victorifeanyi2004_db_user:O3bghiDiSQ8dfUI8@cluster0.sflp6ie.mongodb.net/?appName=Cluster0"
  );

  const db = mongoose.connection.db;

  // UserWallets indexes
  await db
    .collection("userwallets")
    .createIndex({ userId: 1 }, { unique: true });
  await db
    .collection("userwallets")
    .createIndex({ walletAddress: 1 }, { unique: true });

  // Elections indexes
  await db
    .collection("elections")
    .createIndex({ electionId: 1 }, { unique: true });
  await db.collection("elections").createIndex({ status: 1 });
  await db.collection("elections").createIndex({ startTime: 1 });

  // Candidates indexes
  await db
    .collection("candidates")
    .createIndex({ electionId: 1, candidateId: 1 }, { unique: true });
  await db.collection("candidates").createIndex({ electionId: 1 });

  // Votes indexes
  await db
    .collection("votes")
    .createIndex({ electionId: 1, voterAddress: 1 }, { unique: true });
  await db
    .collection("votes")
    .createIndex({ transactionHash: 1 }, { unique: true });
  await db.collection("votes").createIndex({ electionId: 1 });
  await db.collection("votes").createIndex({ candidateId: 1 });

  console.log("✅ All indexes created successfully");
  await mongoose.connection.close();
}

setupIndexes().catch(console.error);
