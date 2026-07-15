import { parseShader } from "../src/transpile/parser";
const src = `
void main() {
	float roughness = 0.5;
	float rust = 0.7;
	if (rust > 0.0)
	{
		float metallic = 0.0;
		rust *= 0.5;
	}
}
`;
try { console.log("OK:", parseShader(src).fns.length, "fns"); }
catch (e) { console.log("FAIL:", e.message); }
