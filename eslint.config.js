import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
    {
        files: ["src/**/*.ts", "tests/**/*.ts", "examples/**/*.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
                warnOnUnsupportedTypeScriptVersion: false,
            },
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
        },
        rules: {
            // Basic rules tailored for TypeScript SDKs
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            "no-console": "off",
        },
    },
];