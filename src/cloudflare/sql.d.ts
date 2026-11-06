declare module "*.sql" {
  const sql: string;
  export default sql;
}

declare module "*.wasm" {
  const wasm: WebAssembly.Module;
  export default wasm;
}

declare module "*.data" {
  const data: ArrayBuffer;
  export default data;
}
