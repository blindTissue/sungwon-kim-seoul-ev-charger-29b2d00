// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Fetch-on-mount / poll effects intentionally set loading state; React Compiler is not enabled.
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
]);
