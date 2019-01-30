/*
 * Copyright 2018 IBM Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const debug = require('debug')('kui-builder/configure')
const path = require('path')
const fs = require('fs-extra')
const colors = require('colors/safe')

const parseOptions = require('./parse-options')

/**
 * Tell the user where we're at
 *
 */
const task = taskName => console.log(colors.dim('task: ') + taskName)

/**
 * Read in index.html
 *
 */
const readIndex = options => new Promise((resolve, reject) => {
  const { templateDir } = options.build

  debug('read template', templateDir)
  task('read index.html template')

  fs.readFile(path.join(templateDir, 'index.html'), (err, data) => {
    if (err) {
      reject(err)
    } else {
      resolve(data.toString())
    }
  })
})

/**
 * Evaluate macros in the given string, using the given setting of configurations
 *
 */
const evaluateMacros = settings => str => {
  debug('evaluateMacros', settings)
  task('evaluate macros', str)

  for (let key in settings) {
    str = str.replace(new RegExp('\\$\\{' + key + '\\}', 'g'), settings[key])
  }

  return str
}

/**
 * Ensure that the buildDir exists
 *
 */
const makeBuildDir = settings => new Promise((resolve, reject) => {
  const { buildDir } = settings.build

  fs.mkdir(buildDir, err => {
    if (err && err.code !== 'EEXIST') {
      reject(err)
    } else {
      resolve()
    }
  })
})

/**
 * Write the updated index.html
 *
 */
const writeIndex = (settings) => str => new Promise((resolve, reject) => {
  if (settings.build.writeIndex === false) {
    return resolve()
  }

  const indexHtml = `index${settings.env.nameSuffix || ''}.html`
  task(`write ${indexHtml}`)

  fs.writeFile(path.join(settings.build.buildDir, indexHtml), str, err => {
    if (err) {
      reject(err)
    } else {
      resolve()
    }
  })
})

/**
 * Stash the chosen configuration settings to the buildDir, and update
 * the app/package.json so that the productName field reflects the
 * chosen setting
 *
 */
const writeConfig = (settings) => new Promise((resolve, reject) => {
  task('write config')

  if (settings.build.writeConfig === false) {
    return resolve()
  }

  const { configDir } = settings.build

  const config = Object.assign({}, settings)
  delete config.build
  debug('writeConfig', configDir, config)

  fs.writeFile(path.join(configDir, 'config.json'), JSON.stringify(config, undefined, 4), err => {
    if (err) {
      reject(err)
    } else {
      task('write package.json')

      const topLevel = require(path.join(configDir, '../package.json'))
      const packageJson = Object.assign({}, topLevel, config)

      fs.writeFile(path.join(configDir, 'package.json'), JSON.stringify(packageJson, undefined, 4), err => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    }
  })
})

/**
 * Do a build
 *
 */
const doBuild = (settings) => () => Promise.all([
  writeConfig(settings),
  readIndex(settings)
    .then(evaluateMacros(settings.env))
    .then(evaluateMacros(settings.theme))
    .then(writeIndex(settings))
])

/**
 * Either project out a field of the configuration settings, or do a build
 *
 */
const doWork = (settings) => {
  return Promise.all([
    fs.mkdirp(settings.build.buildDir),
    fs.mkdirp(settings.build.configDir)
  ])
    .then(doBuild(settings))
    .then(() => colors.green('ok:') + ' build successful')
}

/**
 * Build index.html
 *
 */
const main = (env, overrides = {}) => {
  return parseOptions(env, overrides) // read options
    .then(settings => doWork(settings))
    .then(console.log)
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}

/**
 * Load the overrides from the KUI_BUILD_CONFIG or the default overrides location
 *
 * @param programmaticOverrides if we are being invoked programmatically, such as
 * from webpack.config.js, then this gives the caller the option to
 * specify some overrides via that programmatic call path
 *
 */
const loadOverrides = (programmaticOverrides = {}) => {
  const find = dir => {
    if (dir) {
      if (path.isAbsolute(dir)) {
        return dir
      } else {
        return path.join(process.cwd(), dir)
      }
    }
  }

  const overrideDirectory = find(process.env.KUI_BUILD_CONFIG)

  const loadOverride = (file) => {
    try {
      if (overrideDirectory) {
        debug(`Using this override directory: ${overrideDirectory}`)
        return require(path.join(overrideDirectory, file))
      } else {
        return {}
      }
    } catch (err) {
      return {}
    }
  }
  const userEnv = loadOverride('env')
  const userTheme = loadOverride('theme')
  const userConfig = loadOverride('config')

  const overrides = {
    build: programmaticOverrides.build || {},
    env: Object.assign({}, userEnv, programmaticOverrides.env),
    theme: Object.assign({}, userTheme, programmaticOverrides.theme),
    config: Object.assign({}, userConfig, programmaticOverrides.config)
  }

  if (process.env.KUI_STAGE) {
    overrides.build.configDir = path.join(process.env.KUI_STAGE, 'packages/app/build')
  }

  debug('overrides', overrides)
  return overrides
}

if (require.main === module) {
  debug('called directly')

  main('standalone', loadOverrides())
} else {
  debug('required as a module')

  class Builder {
    /** @param env is one of the entries in ../defaults/envs */
    build (env, overrides) {
      return main(env, loadOverrides(overrides))
    }
  }

  module.exports = Builder
}