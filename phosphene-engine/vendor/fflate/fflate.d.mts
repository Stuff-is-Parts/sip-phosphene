// Minimal declarations for the vendored fflate subset PHOSPHENE calls
// (see PROVENANCE.txt). Only unzipSync is declared; the implementation file
// exports more, but undeclared entry points stay invisible to the compiler
// so every new use forces a conscious declaration here.
export function unzipSync(data: Uint8Array): Record<string, Uint8Array>;
