'use strict';

const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'database', 'media.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS admin (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, hidden) {
  return new Promise((resolve) => {
    if (!hidden) return rl.question(question, resolve);
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    let value = '';
    const onData = (char) => {
      const str = char.toString();
      if (str === '\r' || str === '\n') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (str === '\u0003') {
        process.exit(0);
      } else if (str === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += str;
      }
    };
    stdin.resume();
    stdin.on('data', onData);
  });
}

(async () => {
  const username = (await ask('Admin username: ')).trim();
  const password = await ask('Admin password: ', true);
  rl.close();

  if (!username || password.length < 8) {
    console.error('Username required and password must be at least 8 characters.');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);
  db.prepare(
    `INSERT INTO admin (username, password_hash) VALUES (?, ?)
     ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`
  ).run(username, hash);

  console.log(`\nAdmin "${username}" saved.\n`);
})();