export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['js', 'ts'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { useESM: true }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(octokit)/)',
  ],
}
