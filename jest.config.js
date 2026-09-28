const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

// Specs are locked (and red) at plan time, long before their feature is built.
// A full run (the regression stage) covers only features the ledger marks passing;
// naming test files on the command line (the spec stage) runs them regardless.
const named = process.argv.slice(2).some((arg) => !arg.startsWith('-') && /\.test\.[jt]sx?$/.test(arg));
const ledger = join(__dirname, 'features.json');
const unbuilt =
  named || !existsSync(ledger)
    ? []
    : JSON.parse(readFileSync(ledger, 'utf8'))
        .features.filter((f) => f.status !== 'passing')
        .flatMap((f) => f.tests ?? [])
        .map((file) => `<rootDir>/${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/spec/**/*.test.[jt]s?(x)', '<rootDir>/src/**/*.test.[jt]s?(x)'],
  testPathIgnorePatterns: ['/node_modules/', ...unbuilt],
};
