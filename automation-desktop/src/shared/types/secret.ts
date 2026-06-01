const SECRET_TAG = Symbol('secret')

export type Secret<T> = T & { readonly [SECRET_TAG]: true }

export function brandSecret<T>(value: T): Secret<T> {
  const wrapped = Object(value) as T & { toString?: () => string }
  Object.defineProperty(wrapped, 'toString', {
    value: () => {
      throw new Error('Secret values must not be stringified')
    },
    enumerable: false
  })
  return wrapped as Secret<T>
}
