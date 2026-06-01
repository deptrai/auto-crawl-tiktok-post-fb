import { faker } from '@faker-js/faker'

export interface TestUser {
  id: string
  email: string
  name: string
  role: 'user' | 'admin'
}

export function createUserFactory(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: faker.string.uuid(),
    email: faker.internet.email().toLowerCase(),
    name: faker.person.fullName(),
    role: 'user',
    ...overrides
  }
}
