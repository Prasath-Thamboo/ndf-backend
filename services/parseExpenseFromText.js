export default function parseExpenseFromText(text) {
  const lines = text.split("\n").map(l => l.trim());

  let amount = null;
  let date = null;
  let title = "Note de frais";
  let category = "autre";

  for (const line of lines) {
    // Montant €
    if (!amount) {
      const match = line.match(/(\d+[,.]\d{2})\s?€?/);
      if (match) amount = parseFloat(match[1].replace(",", "."));
    }

    // Date
    if (!date) {
      const match = line.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (match) date = new Date(match[1].split("/").reverse().join("-"));
    }

    // Catégorie simple
    if (/restaurant|repas/i.test(line)) category = "repas";
    if (/hotel|hébergement/i.test(line)) category = "hébergement";
    if (/train|uber|taxi|transport/i.test(line)) category = "transport";
  }

  return {
    title,
    amount,
    date,
    category,
    description: text.slice(0, 500),
  };
}
