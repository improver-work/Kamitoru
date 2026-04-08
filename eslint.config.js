export default [
  {
    ignores: ["dist/", "node_modules/", "src-tauri/"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-console": "off",
    },
  },
];
