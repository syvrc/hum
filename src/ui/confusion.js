// Confusion matrix as an HTML table: rows = what you tapped, columns = what Hum heard.
// The diagonal is "right". Numbers are always printed, so colour is never the only cue.

export function confusionHtml(summary, pads) {
  const name = (id) => pads.find((p) => p.id === id)?.short || id;
  // Column headers break after the zone letter ("N·" / "KNUCKLE") so the table fits a phone.
  const head = summary.labels.map((l) => `<th scope="col">${name(l).replace('·', '·<br>')}</th>`).join('');
  const rows = summary.labels
    .map((truth, i) => {
      const row = summary.matrix[i];
      const total = row.reduce((a, b) => a + b, 0) || 1;
      const cells = row
        .map((v, j) => {
          const frac = v / total;
          const bg = v === 0 ? 'transparent' : i === j ? `rgba(61,255,168,${0.15 + 0.6 * frac})` : `rgba(255,77,77,${0.2 + 0.6 * frac})`;
          return `<td style="background:${bg}">${v}</td>`;
        })
        .join('');
      const recall = summary.perClass[truth];
      return `<tr><th scope="row">${name(truth)}</th>${cells}<td class="cm-recall">${recall === null ? '–' : Math.round(recall * 100) + '%'}</td></tr>`;
    })
    .join('');
  return `<div class="cm-wrap"><table class="cm"><caption>Rows: what you tapped · Columns: what Hum heard</caption>
    <thead><tr><th></th>${head}<th scope="col">right</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** Plain-English notes on the most-confused pairs. */
export function confusionAdvice(summary, pads) {
  const name = (id) => pads.find((p) => p.id === id)?.label || id;
  const pairs = [];
  summary.labels.forEach((a, i) =>
    summary.labels.forEach((b, j) => {
      if (j <= i) return;
      const n = summary.matrix[i][j] + summary.matrix[j][i];
      const tot = summary.matrix[i].reduce((x, y) => x + y, 0) + summary.matrix[j].reduce((x, y) => x + y, 0);
      if (n > 0 && n / tot >= 0.1) pairs.push({ a, b, frac: n / tot });
    }),
  );
  pairs.sort((x, y) => y.frac - x.frac);
  return pairs.slice(0, 2).map((p) => `${name(p.a)} and ${name(p.b)} sound alike (${Math.round(p.frac * 100)}% mixed up).`);
}
