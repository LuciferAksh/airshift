export const byId = (id) => document.getElementById(id);
export const setText = (id, text) => { byId(id).textContent = text; };
export const number = (value) => value.toLocaleString('en-IN', { maximumFractionDigits: 1 });

export function responseError(error, fallback) {
  return error instanceof Error && error.message && error.name === 'Error' ? error.message : fallback;
}
