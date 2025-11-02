import { test, expect, describe } from "bun:test";

// Define the server address
const baseURL = "http://localhost:3000";

// --- Helper Functions ---

// Helper to post a block
const postBlock = (block: any) => {
  return fetch(`${baseURL}/blocks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(block),
  });
};

// Helper to get a balance
const getBalance = async (address: string) => {
  const res = await fetch(`${baseURL}/balance/${address}`);
  const data = await res.json();
  return data.balance;
};

// Helper to post a rollback
const postRollback = (height: number) => {
  return fetch(`${baseURL}/rollback?height=${height}`, {
    method: "POST",
  });
};

// --- Test Data (Blocks with correct hashes) ---

const block1 = {
  id: "d1582b9e2cac15e170c39ef2e85855ffd7e6a820550a8ca16a2f016d366503dc",
  height: 1,
  transactions: [{ id: "tx1", inputs: [], outputs: [{ address: "addr1", value: 10 }] }]
};

const block2 = {
  id: "c4701d0bfd7179e1db6e33e947e6c718bbc4a1ae927300cd1e3bda91a930cba5",
  height: 2,
  transactions: [{
    id: "tx2",
    inputs: [{ txId: "tx1", index: 0 }],
    outputs: [{ address: "addr2", value: 4 }, { address: "addr3", value: 6 }]
  }]
};

const block3 = {
  id: "4e5f22a2abacfaf2dcaaeb1652aec4eb65028d0f831fa435e6b1ee931c6799ec",
  height: 3,
  transactions: [{
    id: "tx3",
    inputs: [{ txId: "tx2", index: 1 }],
    outputs: [{ address: "addr4", value: 2 }, { address: "addr5", value: 2 }, { address: "addr6", value: 2 }]
  }]
};

// --- Main Test Suite ---

describe("Blockchain Indexer API", () => {

  // IMPORTANT: Before running this test, you must reset the database
  // to a clean state by running:
  // 'docker-compose down -v && docker-compose up -d --build'
  // We add this test to remind you.
  test("Server is ready for testing", async () => {
    const res = await getBalance("addr1");
    expect(res).toBe(0); // On a clean DB, balance should be 0
  });

  test("1. POST /blocks - Should add Block 1", async () => {
    const res = await postBlock(block1);
    const data = await res.json();
    expect(res.status).toBe(201); // Should be 201 Created
    expect(data.message).toBe("Block 1 added successfully");
  });

  test("2. POST /blocks - Should add Block 2", async () => {
    const res = await postBlock(block2);
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.message).toBe("Block 2 added successfully");
  });

  test("3. POST /blocks - Should add Block 3", async () => {
    const res = await postBlock(block3);
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.message).toBe("Block 3 added successfully");
  });

  test("4. GET /balance - Should get correct balances after 3 blocks", async () => {
    expect(await getBalance("addr1")).toBe(0); // Spent in Block 2
    expect(await getBalance("addr2")).toBe(4); // Received in Block 2
    expect(await getBalance("addr3")).toBe(0); // Received in Block 2, Spent in Block 3
    expect(await getBalance("addr4")).toBe(2); // Received in Block 3
  });

  test("5. POST /rollback - Should roll back to height 2", async () => {
    const res = await postRollback(2);
    const data = await res.json();
    expect(res.status).toBe(200); // Should be 200 OK
    expect(data.message).toBe("Successfully rolled back to height 2");
  });

  test("6. GET /balance - Should have rolled-back balances", async () => {
    // Block 3's effects should be undone
    expect(await getBalance("addr4")).toBe(0); // addr4 should no longer exist
    expect(await getBalance("addr3")).toBe(6); // addr3's balance should be restored
  });

  test("7. POST /blocks - Should fail to add Block 2 again (invalid height)", async () => {
    // We are currently at height 2. Trying to add Block 2 again
    // should fail with "Invalid height. Expected 3..."
    const res = await postBlock(block2);
    expect(res.status).toBe(400); // Should be 400 Bad Request
    const data = await res.json();
    expect(data.error).toContain("Invalid height. Expected 3");
  });

});