declare module "wgsl_reflect/wgsl_reflect.module.js" {
  export class WgslReflect {
    constructor(code: string);
    entry: {
      vertex: unknown[];
      fragment: unknown[];
      compute: unknown[];
    };
  }
}
