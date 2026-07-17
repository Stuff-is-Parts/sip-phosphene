// Flat config, language-level rules only. No project-specific/behavioral rules.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',      // catches scaffolding never wired
      '@typescript-eslint/no-floating-promises': 'off',  // needs type info; on in typed mode
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
      'no-self-assign': 'error',
      'eqeqeq': 'error',
      'no-undef': 'error'
    }
  }
);
