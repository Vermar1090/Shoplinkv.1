const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

const db = new sqlite3.Database("./backend/database.sqlite");

db.serialize(() => {
  const schema = fs.readFileSync("./backend/models.sql", "utf8");
  db.exec(schema);
});

module.exports = db;
