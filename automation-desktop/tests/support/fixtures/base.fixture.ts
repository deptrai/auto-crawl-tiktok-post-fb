import { test as base } from '@playwright/test'
import type { TestUser } from '../factories/user-factory'
import { createUserFactory } from '../factories/user-factory'

type Fixtures = {
  authenticatedUser: TestUser
}

export const test = base.extend<Fixtures>({
  authenticatedUser: async (_fixtures, use) => {
    void _fixtures
    const user = createUserFactory({ role: 'admin' })
    await use(user)
    // Placeholder teardown hook for future persistence-backed cleanup.
  }
})

export const expect = test.expect
