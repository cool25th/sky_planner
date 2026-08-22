import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function resolve(specifier, context, next) {
  if (specifier === "server-only" || specifier === "client-only") {
    return { url: "data:text/javascript,export default {};", shortCircuit: true };
  }
  const isAlias = specifier.startsWith("@/");
  const isRelative = (specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL;
  if (isAlias || isRelative) {
    const base = isAlias
      ? path.join(projectRoot, specifier.slice(2))
      : path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    const candidate = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find(existsSync);
    if (candidate) return next(pathToFileURL(candidate).href, context);
  }
  return next(specifier, context);
}
