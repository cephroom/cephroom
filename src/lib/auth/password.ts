import bcrypt from "bcryptjs";

const ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export interface PasswordProblem {
  message: string;
}

/**
 * Deliberately modest rules. Length is the only requirement that reliably
 * correlates with strength; character-class rules mostly produce Passw0rd!.
 */
export function checkPassword(plain: string): PasswordProblem | null {
  if (plain.length < 10) {
    return { message: "Use at least 10 characters." };
  }
  if (plain.length > 200) {
    return { message: "That is longer than 200 characters." };
  }
  if (/^\s|\s$/.test(plain)) {
    return { message: "Remove the leading or trailing whitespace." };
  }
  const common = new Set([
    "password12",
    "1234567890",
    "qwertyuiop",
    "passw0rd12",
    "letmein123",
  ]);
  if (common.has(plain.toLowerCase())) {
    return { message: "That password is on every breach list there is." };
  }
  return null;
}
