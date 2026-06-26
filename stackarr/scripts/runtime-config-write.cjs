#!/usr/bin/env node
const fs = require('node:fs');
const { writeSettings } = require('./stackarr-db.cjs');

const dbPath = process.env.STACKARR_DATABASE_FILE;
const input = process.argv[2];
const value = process.argv[3];
if (!dbPath || !input) process.exit(2);

const patch = value === undefined ? JSON.parse(fs.readFileSync(input, 'utf8')) : { [input]: value };
writeSettings(patch);
