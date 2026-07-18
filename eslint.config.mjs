// Flat config, language-level rules only. No project-specific/behavioral rules.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        // browser
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        requestAnimationFrame: 'readonly', devicePixelRatio: 'readonly',
        AudioContext: 'readonly', AnalyserNode: 'readonly', MediaStream: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', setTimeout: 'readonly',
        fetch: 'readonly', Blob: 'readonly', URL: 'readonly',
        addEventListener: 'readonly', alert: 'readonly', crypto: 'readonly',
        customElements: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly',
        performance: 'readonly', TextEncoder: 'readonly',
        GPUShaderStage: 'readonly', GPUTextureUsage: 'readonly', GPUBufferUsage: 'readonly',
        AudioWorkletNode: 'readonly',
        // AudioWorklet global scope (src/audio/pcm-tap.js)
        AudioWorkletProcessor: 'readonly', registerProcessor: 'readonly', sampleRate: 'readonly',
        // node
        console: 'readonly', process: 'readonly',
      },
    },
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
