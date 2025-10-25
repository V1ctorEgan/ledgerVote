const mongoose = require("mongoose");
const fs = require("fs");

// Define schemas (copy from main backend file)
const userWalletSchema = new mongoose.Schema({
  userId: String,
  walletAddress: String,
  encryptedPrivateKey: String,
  createdAt: Date,
});

const electionSchema = new mongoose.Schema({
  electionId: String,
  title: String,
  description: String,
  startTime: Number,
  endTime: Number,
  status: String,
  finalized: Boolean,
  transactionHash: String,
  createdAt: Date,
});

// ... other schemas

const UserWallet = mongoose.model("UserWallet", userWalletSchema);
const Election = mongoose.model("Election", electionSchema);

async function migrate() {
  await mongoose.connect("mongodb://localhost:27017/voting_system");

  // Import user wallets
  if (fs.existsSync("user_wallets.json")) {
    const wallets = fs
      .readFileSync("user_wallets.json", "utf8")
      .split("\n")
      .filter((line) => line)
      .map((line) => JSON.parse(line));

    for (const wallet of wallets) {
      await UserWallet.create({
        userId: wallet.user_id,
        walletAddress: wallet.wallet_address,
        encryptedPrivateKey: wallet.encrypted_private_key,
        createdAt: wallet.created_at,
      });
    }
    console.log(`✅ Migrated ${wallets.length} user wallets`);
  }

  // Import elections
  if (fs.existsSync("elections.json")) {
    const elections = fs
      .readFileSync("elections.json", "utf8")
      .split("\n")
      .filter((line) => line)
      .map((line) => JSON.parse(line));

    for (const election of elections) {
      await Election.create({
        electionId: election.election_id,
        title: election.title,
        description: election.description,
        startTime: election.start_time,
        endTime: election.end_time,
        status: election.status,
        finalized: election.finalized,
        transactionHash: election.transaction_hash,
        createdAt: election.created_at,
      });
    }
    console.log(`✅ Migrated ${elections.length} elections`);
  }

  // Similar for candidates and votes...

  await mongoose.connection.close();
  console.log("✅ Migration complete!");
}

migrate().catch(console.error);
