import type { Customer } from "../types";

// One canonical form used for all name matching: trimmed, inner runs of
// whitespace collapsed to one space, lower-cased. So "  Rahul   Kumar " and
// "rahul kumar" both reduce to "rahul kumar" and count as the same person.
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// What actually gets stored and shown — trimmed with whitespace collapsed,
// but keeping the capitalisation the user typed.
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

// Finds an existing non-walk-in customer whose name matches `name` (by the
// canonical form above). Returns undefined if there's no match.
export function findCustomerByName(customers: Customer[], name: string): Customer | undefined {
  const key = normalizeName(name);
  if (!key) return undefined;
  return customers.find((c) => !c.isWalkIn && normalizeName(c.name) === key);
}

// When two different people genuinely share a name (two customers both called
// "Rahul"), this tells them apart: the profile that was created first stays
// "Rahul", the next is "Rahul (2)", then "Rahul (3)". Keyed off createdAt so a
// given customer's label never shifts as other people are added later.
export function customerLabel(customer: Customer, allCustomers: Customer[]): string {
  if (customer.isWalkIn) return customer.name;
  const key = normalizeName(customer.name);
  const sameName = allCustomers
    .filter((c) => !c.isWalkIn && normalizeName(c.name) === key)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  if (sameName.length <= 1) return customer.name;
  const idx = sameName.findIndex((c) => c.id === customer.id);
  return idx <= 0 ? customer.name : `${customer.name} (${idx + 1})`;
}
