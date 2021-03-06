import { isPlainObject } from './isPlainObject'

export const merge = (target, patch, merger) => {
  if (process.env.NODE_ENV !== 'production') {
    if (!isPlainObject(target)) {
      throw new Error(
        `target param is not valid. Expecting: object! Received: ${Object.prototype.toString.call(
          target
        )}.`
      )
    }
  }

  const patches = Array.isArray(patch) ? patch : [patch]
  let merged = target

  patches.forEach(currentPatch => {
    if (!isPlainObject(currentPatch)) {
      return
    }

    const keysToPatch = Object.keys(currentPatch)

    keysToPatch.forEach(keyToPatch => {
      const hasValue = Object.hasOwnProperty.call(target, keyToPatch)
      const oldValue = target[keyToPatch]
      const newValue = currentPatch[keyToPatch]
      const mergedValue = merger
        ? merger(oldValue, newValue, keyToPatch)
        : newValue

      if (!hasValue || mergedValue !== oldValue) {
        if (merged === target) {
          merged = Object.assign({}, target)
        }

        merged[keyToPatch] = mergedValue
      }
    })
  })

  return merged
}

export const mergeDeep = (target, patch, merger) => {
  return merge(target, patch, (oldValue, newValue, key) => {
    if (isPlainObject(oldValue) && isPlainObject(newValue)) {
      return mergeDeep(oldValue, newValue, merger)
    }

    return merger ? merger(oldValue, newValue, key) : newValue
  })
}
