'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var memoize = _interopDefault(require('fast-memoize'));

const isPlainObject = maybeObject =>
  maybeObject &&
  typeof maybeObject === 'object' &&
  (typeof maybeObject.constructor !== 'function' ||
    maybeObject.constructor.name === 'Object');

const merge = (target, patch, merger) => {
  if (!isPlainObject(target)) {
    throw new Error(
      "Target is not a plain object. Can't merge into a not 'plain object like' structure!"
    )
  }

  const patches = Array.isArray(patch) ? patch : [patch];
  let merged = target;

  patches.forEach(currentPatch => {
    if (!isPlainObject(currentPatch)) {
      return
    }

    const keysToPatch = Object.keys(currentPatch);

    keysToPatch.forEach(keyToPatch => {
      const hasValue = Object.hasOwnProperty.call(target, keyToPatch);
      const oldValue = target[keyToPatch];
      const newValue = currentPatch[keyToPatch];
      const mergedValue = merger
        ? merger(oldValue, newValue, keyToPatch)
        : newValue;

      if (!hasValue || mergedValue !== oldValue) {
        if (merged === target) {
          merged = Object.assign({}, target);
        }

        merged[keyToPatch] = mergedValue;
      }
    });
  });

  return merged
};

const mergeDeep = (target, patch, merger) => {
  return merge(target, patch, (oldValue, newValue, key) => {
    if (isPlainObject(oldValue) && isPlainObject(newValue)) {
      return mergeDeep(oldValue, newValue, merger)
    }

    return merger ? merger(oldValue, newValue, key) : newValue
  })
};

const parsePathname = pathname => {
  if (typeof pathname !== 'string') {
    throw new Error(
      `Pathname is not valid. Expected: string! Received: ${Object.prototype.toString.call(
        pathname
      )}.`
    )
  }

  const [dirty, ...splitPathname] = pathname.split('/');

  if (dirty || !splitPathname.length) {
    throw new Error("Pathname is not valid. It should start with '/'!")
  }

  if (!splitPathname[0]) {
    splitPathname[0] = '/';
  }

  return splitPathname
};

const addStrategyMerger = (oldValue, newValue) => {
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    return [...oldValue, ...newValue]
  }

  return newValue
};

const removeStrategyMerger = (oldValue, newValue) => {
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    return oldValue.filter((item, i) => !newValue.includes(item))
  }

  return newValue
};

const mutateQueryParams = strategy =>
  memoize((queryParams, params) => mergeDeep(queryParams, params, strategy));

const addQueryParams = mutateQueryParams(addStrategyMerger);

const removeQueryParams = mutateQueryParams(removeStrategyMerger);

const QUERYSTRING_CACHE_STATE_KEY = '__querystringCacheStateObject__';
const WILDCARD_SCOPE = '*';
const PERSISTED_KEY = 'persisted';
const SHADOW_KEY = Symbol('shadow');

const mergeMutationIntoCache = (cache, [path, ...restPath], payload) => {
  const occurrence = Object.keys(cache).find(key => key === path);

  if (path) {
    if (!occurrence) {
      cache[path] = {
        path,
        nested: {},
        [PERSISTED_KEY]: {},
        [SHADOW_KEY]: {}
      };
    }

    const partialCache = cache[occurrence || path];

    if (!restPath.length) {
      const { persist, add, remove } = payload;
      const strategy = persist ? PERSISTED_KEY : SHADOW_KEY;

      partialCache.mutated = true;

      if (remove) {
        partialCache[strategy] = removeQueryParams(
          partialCache[strategy],
          remove
        );
      }

      if (add) {
        partialCache[strategy] = addQueryParams(partialCache[strategy], add);
      }

      Object.keys(partialCache.nested).forEach(key =>
        flushNestedPartialCache(partialCache.nested[key])
      );
    }

    Object.assign(
      partialCache.nested,
      mergeMutationIntoCache(partialCache.nested, restPath, payload)
    );
  }
};

const pickBranchFromCache = (cache, [path, ...restPath], destination = []) => {
  if (path) {
    const partialWildcardCache = cache[WILDCARD_SCOPE];
    const partialCache = cache[path];

    if (partialWildcardCache && partialWildcardCache.mutated) {
      destination.push(partialWildcardCache);
    }

    if (partialCache && partialCache.mutated) {
      destination.push(partialCache);
    }

    return partialCache
      ? pickBranchFromCache(partialCache.nested, restPath, destination)
      : destination
  } else {
    return destination
  }
};

const flushPartialCache = partialCache => (partialCache[SHADOW_KEY] = {});

const flushNestedPartialCache = partialCache => {
  if (partialCache.nested) {
    partialCache[SHADOW_KEY] = {};

    Object.keys(partialCache.nested).forEach(key =>
      flushPartialCache(partialCache.nested[key])
    );
  }
};

const queryStore = {
  add ({ pathname, state }) {
    const { mutations } = (state && state[QUERYSTRING_CACHE_STATE_KEY]) || {};

    if (!mutations) {
      return this
    }

    mutations.forEach(({ scope }, i) =>
      mergeMutationIntoCache(
        this.cache,
        parsePathname(scope || pathname),
        mutations[i]
      )
    );

    Object.keys(this.cache)
      .filter(
        key => ![WILDCARD_SCOPE, parsePathname(pathname)[0]].includes(key)
      )
      .forEach(key => flushNestedPartialCache(this.cache[key]));

    return this
  },
  clear () {
    Object.keys(this.cache).forEach(key => delete this.cache[key]);

    return this
  },
  resolveQueryString (scope, mutations = []) {
    const parsedPathname = parsePathname(scope);
    const branch = pickBranchFromCache(this.cache, parsedPathname);
    let queryParams = branch.reduce(
      (destination, partialCache) =>
        addQueryParams(destination, {
          ...partialCache[SHADOW_KEY],
          ...partialCache[PERSISTED_KEY]
        }),
      {}
    );

    mutations.forEach(({ add, remove }) => {
      if (remove) {
        queryParams = removeQueryParams(queryParams, remove);
      }

      if (add) {
        queryParams = addQueryParams(queryParams, add);
      }
    });

    return this.stringifyQueryParams(queryParams)
  },
  toString () {
    return JSON.stringify(this.cache)
  }
};

const createStateObject = ({ mutations } = {}) => ({
  [QUERYSTRING_CACHE_STATE_KEY]: {
    mutations: mutations || []
  }
});

let store;
const createQueryStore = ({
  initialCache,
  parseQueryString,
  stringifyQueryParams
} = {}) => {
  if (!store) {
    store = Object.create(
      {
        ...queryStore,
        createStateObject,
        parseQueryString,
        stringifyQueryParams
      },
      {
        cache: {
          value: initialCache || {}
        }
      }
    );
  }

  return store
};

exports.PERSISTED_KEY = PERSISTED_KEY;
exports.SHADOW_KEY = SHADOW_KEY;
exports.addQueryParams = addQueryParams;
exports.createQueryStore = createQueryStore;
exports.removeQueryParams = removeQueryParams;
