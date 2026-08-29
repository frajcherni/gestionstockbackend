/**
 * Discount maths shared by the Offer banner and the Promo band.
 *
 * Both let the shop owner enter EITHER a percentage ("-20%") OR the reduced
 * price, while the website needs both at once (red badge + struck-through
 * catalogue price). Keeping the resolution here means the two features can
 * never drift into disagreeing about what "-20%" costs.
 */

/** Postgres returns DECIMAL columns as strings, so every read goes through this. */
const toNumber = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Fills in whichever side of the discount was not typed.
 *
 * `source` needs `discount_percent` and/or `promo_price`; `basePrice` is the
 * article's catalogue price (puv_ttc).
 *
 * Returns { old_price, final_price, discount_percent } — all null when there
 * is no usable discount, in which case the website shows the plain price.
 */
function resolveDiscount(source, basePrice) {
  const base = toNumber(basePrice);
  const stored = toNumber(source?.promo_price);
  const percent = toNumber(source?.discount_percent);

  if (base === null || base <= 0) {
    return { old_price: null, final_price: stored, discount_percent: percent };
  }

  // An explicit price wins: it is the exact amount the client pays, so the
  // badge is always derived from it — never from a stale percentage left in
  // the form, which would advertise a discount the price does not match.
  if (stored !== null && stored > 0 && stored < base) {
    const derived = Math.round(((base - stored) / base) * 100);
    // A saving too small to round to 1% would render as a "-0%" badge.
    if (derived < 1) return { old_price: null, final_price: null, discount_percent: null };
    return { old_price: base, final_price: stored, discount_percent: derived };
  }

  if (percent !== null && percent > 0 && percent < 100) {
    return {
      old_price: base,
      final_price: Number((base * (1 - percent / 100)).toFixed(3)),
      discount_percent: percent,
    };
  }

  return { old_price: null, final_price: null, discount_percent: null };
}

/** Strips an absolute upload path down to the relative one the website wants. */
function toRelativePath(p) {
  if (!p) return null;
  const s = p.replace(/\\/g, "/");
  const match = s.match(/uploads\/.*/i);
  return match ? match[0] : s;
}

module.exports = { toNumber, resolveDiscount, toRelativePath };
