import { customAlphabet } from 'nanoid'

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
const gen = customAlphabet(alphabet, 16)

export function id(prefix: string): string {
  return `${prefix}_${gen()}`
}

export function token(): string {
  return customAlphabet(alphabet, 28)()
}
