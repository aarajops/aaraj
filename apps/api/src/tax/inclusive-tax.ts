export type InclusiveTaxTreatment = "taxable" | "exempt";

export type InclusiveTaxResult = {
  taxableBaseBdt: number;
  taxAmountBdt: number;
};

export function calculateInclusiveTaxBdt(input: {
  grossAmountBdt: number;
  treatment: InclusiveTaxTreatment;
  rateNumerator: number | null;
  rateDenominator: number | null;
}): InclusiveTaxResult {
  assertSafeAmount(input.grossAmountBdt);
  if (input.treatment === "exempt") {
    if (input.rateNumerator !== null || input.rateDenominator !== null) {
      throw new Error("Exempt tax treatment must not include a rate.");
    }
    return { taxableBaseBdt: input.grossAmountBdt, taxAmountBdt: 0 };
  }
  if (
    !Number.isSafeInteger(input.rateNumerator) ||
    !Number.isSafeInteger(input.rateDenominator) ||
    input.rateNumerator! <= 0 ||
    input.rateDenominator! <= 0
  ) {
    throw new Error("Taxable treatment requires a positive rational rate.");
  }

  const gross = BigInt(input.grossAmountBdt);
  const numerator = BigInt(input.rateNumerator!);
  const denominator = BigInt(input.rateDenominator!);
  const tax = roundHalfUp(gross * numerator, denominator + numerator);
  const taxableBase = gross - tax;
  const taxAmountBdt = safeNumber(tax);
  const taxableBaseBdt = safeNumber(taxableBase);
  if (taxableBaseBdt + taxAmountBdt !== input.grossAmountBdt) {
    throw new Error(
      "Inclusive tax calculation did not reconcile to its gross amount.",
    );
  }
  return { taxableBaseBdt, taxAmountBdt };
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new Error(
      "Tax arithmetic requires nonnegative amounts and a positive denominator.",
    );
  }
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function assertSafeAmount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("BDT amounts must be nonnegative safe integers.");
  }
}

function safeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Calculated BDT amount exceeds the safe integer range.");
  }
  return result;
}
