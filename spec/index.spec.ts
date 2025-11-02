import { test, expect, describe } from "bun:test";

// Sunucumuzun adresini tanımlayalım
const baseURL = "http://localhost:3000";

// Testlerimizde kullanacağımız doğru hash'lere sahip bloklar
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

// Ana test senaryomuz
describe("Blockchain Indexer API", () => {

  // Testlere başlamadan önce, temiz bir veritabanı olduğundan emin olmak için
  // veritabanını sıfırlamamız GEREKİR.
  // Lütfen bu testi çalıştırmadan önce terminalde
  // 'docker-compose down -v && docker-compose up -d --build' komutunu çalıştırın.

  test("1. POST /blocks - Should add Block 1", async () => {
    const res = await fetch(`${baseURL}/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(block1),
    });
    const data = await res.json();

    expect(res.status).toBe(201); // 201 Created olmalı
    expect(data.message).toBe("Block 1 added successfully");
  });

  test("2. POST /blocks - Should add Block 2", async () => {
    const res = await fetch(`${baseURL}/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(block2),
    });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.message).toBe("Block 2 added successfully");
  });

  test("3. POST /blocks - Should add Block 3", async () => {
    const res = await fetch(`${baseURL}/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(block3),
    });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.message).toBe("Block 3 added successfully");
  });

  test("4. GET /balance - Should get correct balances after 3 blocks", async () => {
    let res = await fetch(`${baseURL}/balance/addr3`);
    let data = await res.json();
    expect(data.balance).toBe(0); // Blok 3'te harcandı

    res = await fetch(`${baseURL}/balance/addr4`);
    data = await res.json();
    expect(data.balance).toBe(2); // Blok 3'te aldı
  });

  test("5. POST /rollback - Should roll back to height 2", async () => {
    const res = await fetch(`${baseURL}/rollback?height=2`, {
      method: "POST",
    });
    const data = await res.json();

    expect(res.status).toBe(200); // 200 OK olmalı
    expect(data.message).toBe("Successfully rolled back to height 2");
  });

  test("6. GET /balance - Should have rolled-back balances", async () => {
    // Blok 3'ün etkileri geri alınmış olmalı
    let res = await fetch(`${baseURL}/balance/addr4`);
    let data = await res.json();
    expect(data.balance).toBe(0); // addr4 artık yok

    res = await fetch(`${baseURL}/balance/addr3`);
    data = await res.json();
    expect(data.balance).toBe(6); // addr3'ün bakiyesi geri yüklendi
  });

  test("7. POST /blocks - Should fail to add Block 2 again (invalid height)", async () => {
    // Şu anda yükseklik 2'deyiz. Blok 2'yi tekrar eklemeye çalışmak
    // "Invalid height. Expected 3..." hatası vermeli.
    const res = await fetch(`${baseURL}/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(block2),
    });

    expect(res.status).toBe(400); // 400 Bad Request olmalı
    const data = await res.json();
    expect(data.error).toContain("Invalid height");
  });

});