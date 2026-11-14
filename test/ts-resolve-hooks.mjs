// Resolve hook (see ts-resolve.mjs): a relative import with no extension, from a .ts file, is
// retried as '<specifier>.ts'.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (relative && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith('.ts')) {
      return next(`${specifier}.ts`, context);
    }
    throw err;
  }
}
