#!/usr/bin/env node

import crypto from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE_URL = 'https://easy-statuses-589727.framer.app'
const BASE_HOST = new URL(BASE_URL).host
const ALLOWED_HOSTS = new Set([BASE_HOST, 'framerusercontent.com'])
const USER_AGENT = 'Mozilla/5.0 (compatible; local-portfolio-script/1.0)'
const FRAMER_EDITOR_INIT_URL = 'https://framer.com/edit/init.mjs'
const LOCAL_EDITOR_INIT_URL = '/site/_assets/editor/init.mjs'
const EDITOR_INIT_PLACEHOLDER = '// Local placeholder for Framer editor preload.\n'
const SITEMAP_PATH = '/sitemap.xml'

const KNOWN_PAGE_PATHS = [
  '/',
  '/projects',
  '/experience',
  '/404',
  '/projects/11111',
  '/projects/streamline-crm',
  '/projects/orbit-dashboard',
  '/projects/bloomly-onboarding',
  '/projects/novapay-mobile',
]

const TEXT_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.mjs',
  '.js',
  '.css',
  '.json',
  '.svg',
  '.xml',
  '.txt',
])

const ABSOLUTE_URL_REGEX = /https?:\/\/[^\s"'`<>\\)]+/g
const RESOURCE_REGEX_LIST = [
  /(?:href|src)=['"]([^'"#]+)['"]/g,
  /(?:from\s*|import\s*\(\s*)["'`]([^"'`]+)["'`]/g,
  /url\((['"]?)([^)"']+)\1\)/g,
]
const PAGE_ATTR_REGEX = /(href|src)=['"](\.\/[^'"?#]*|\/[^'"?#]*)['"]/g

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const outputRoot = path.join(projectRoot, 'public', 'site')

function createState() {
  return {
    visited: new Set(),
    queue: [],
    resources: new Map(),
    textFiles: new Set(),
    pageRouteMap: new Map(),
  }
}

function normalizeRoute(route) {
  if (!route || route === '/') return '/'

  let normalized = route
  if (!normalized.startsWith('/')) normalized = `/${normalized}`

  normalized = normalized.replace(/\/+/g, '/')
  normalized = normalized.replace(/\/+$/, '')
  return normalized || '/'
}

function routeToWebPath(route) {
  const normalizedRoute = normalizeRoute(route)
  if (normalizedRoute === '/') return '/site/index.html'
  return `/site${normalizedRoute}/index.html`
}

function hashString(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 10)
}

function sanitizeSegment(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function ensureAllowed(urlString) {
  try {
    const url = new URL(urlString)
    return ALLOWED_HOSTS.has(url.host)
  } catch {
    return false
  }
}

function isTextLike(contentType, pathname) {
  if (contentType) {
    const lower = contentType.toLowerCase()
    if (lower.startsWith('text/')) return true
    if (lower.includes('javascript')) return true
    if (lower.includes('json')) return true
    if (lower.includes('xml')) return true
    if (lower.includes('svg')) return true
  }

  return TEXT_EXTENSIONS.has(path.extname(pathname).toLowerCase())
}

function assetUrlToWebPath(urlObj) {
  const segments = urlObj.pathname.split('/').filter(Boolean).map(sanitizeSegment)

  let filename = segments.pop() ?? 'index'
  const directory = segments.join('/')

  if (!filename.includes('.')) {
    filename = `${filename}.bin`
  }

  if (urlObj.search) {
    const ext = path.extname(filename)
    const base = ext ? filename.slice(0, -ext.length) : filename
    filename = `${base}__${hashString(urlObj.search)}${ext}`
  }

  const safeHost = sanitizeSegment(urlObj.host)
  return `/site/_assets/${safeHost}/${directory ? `${directory}/` : ''}${filename}`
}

function webPathToDiskPath(webPath) {
  const relativePath = webPath.replace(/^\/site\//, '')
  return path.join(outputRoot, relativePath)
}

function extractAbsoluteUrls(text) {
  const urls = new Set()

  for (const match of text.matchAll(ABSOLUTE_URL_REGEX)) {
    const cleaned = match[0].replace(/["'),]+$/g, '')
    const normalized = cleaned.replace(/&amp;/g, '&')

    if (ensureAllowed(normalized)) {
      urls.add(normalized)
    }
  }

  return [...urls]
}

function resolveResourceUrl(rawCandidate, baseUrl) {
  if (!rawCandidate) return null

  const candidate = rawCandidate.trim().replace(/&amp;/g, '&')
  if (!candidate) return null
  if (candidate.startsWith('#')) return null

  if (
    candidate.startsWith('mailto:') ||
    candidate.startsWith('tel:') ||
    candidate.startsWith('javascript:') ||
    candidate.startsWith('data:')
  ) {
    return null
  }

  if (
    !candidate.startsWith('http://') &&
    !candidate.startsWith('https://') &&
    !candidate.startsWith('//') &&
    !candidate.startsWith('/') &&
    !candidate.startsWith('./') &&
    !candidate.startsWith('../') &&
    !candidate.startsWith('?')
  ) {
    return null
  }

  if (candidate.includes('${') || candidate.includes('`') || /\s/.test(candidate)) {
    return null
  }

  try {
    const absoluteUrl = new URL(candidate, baseUrl)
    absoluteUrl.hash = ''
    if (!ALLOWED_HOSTS.has(absoluteUrl.host)) return null
    return absoluteUrl.toString()
  } catch {
    return null
  }
}

function extractTextResourceUrls(text, sourceUrl) {
  const discoveredUrls = new Set()

  for (const regex of RESOURCE_REGEX_LIST) {
    for (const match of text.matchAll(regex)) {
      const rawValue = match[2] ?? match[1]
      const resolvedUrl = resolveResourceUrl(rawValue, sourceUrl)

      if (resolvedUrl) {
        discoveredUrls.add(resolvedUrl)
      }
    }
  }

  for (const absoluteUrl of extractAbsoluteUrls(text)) {
    const resolvedUrl = resolveResourceUrl(absoluteUrl, sourceUrl)
    if (resolvedUrl) {
      discoveredUrls.add(resolvedUrl)
    }
  }

  return [...discoveredUrls]
}

function addResourceMapping(state, sourceUrl, webPath, diskPath, isText, kind) {
  state.resources.set(sourceUrl, { webPath, diskPath, isText, kind })

  const urlObj = new URL(sourceUrl)
  if (urlObj.search || urlObj.hash) return

  const noSlashVariant = `${urlObj.origin}${normalizeRoute(urlObj.pathname)}`
  state.resources.set(noSlashVariant, { webPath, diskPath, isText, kind })

  if (normalizeRoute(urlObj.pathname) !== '/') {
    state.resources.set(`${noSlashVariant}/`, { webPath, diskPath, isText, kind })
  }
}

function enqueue(state, urlString) {
  let parsedUrl
  try {
    parsedUrl = new URL(urlString)
  } catch {
    return
  }

  parsedUrl.hash = ''
  const normalizedUrl = parsedUrl.toString()

  if (!ALLOWED_HOSTS.has(parsedUrl.host)) return
  if (state.visited.has(normalizedUrl)) return

  state.visited.add(normalizedUrl)
  state.queue.push(normalizedUrl)
}

async function writeFileSafe(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

function inferPageRoute(urlObj) {
  if (urlObj.host !== BASE_HOST) return null
  if (urlObj.search || urlObj.hash) return null
  if (path.extname(urlObj.pathname)) return null
  return normalizeRoute(urlObj.pathname)
}

async function processUrl(state, urlString) {
  const urlObj = new URL(urlString)
  const pageRoute = inferPageRoute(urlObj)
  const isPage = pageRoute !== null

  const response = await fetch(urlString, {
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT },
  })

  if (!response.ok) {
    console.warn(`Skipped ${urlString} (${response.status})`)
    return
  }

  const contentType = response.headers.get('content-type') || ''
  const buffer = Buffer.from(await response.arrayBuffer())

  const webPath = isPage ? routeToWebPath(pageRoute) : assetUrlToWebPath(urlObj)
  const diskPath = webPathToDiskPath(webPath)
  const textLike = isTextLike(contentType, urlObj.pathname)

  if (isPage) {
    state.pageRouteMap.set(pageRoute, webPath)
  }

  addResourceMapping(state, urlString, webPath, diskPath, textLike, isPage ? 'page' : 'asset')

  if (textLike) {
    const content = new TextDecoder('utf-8').decode(buffer)
    await writeFileSafe(diskPath, content)
    state.textFiles.add(diskPath)

    for (const discoveredUrl of extractTextResourceUrls(content, urlString)) {
      enqueue(state, discoveredUrl)
    }
  } else {
    await writeFileSafe(diskPath, buffer)
  }

  console.log(`Downloaded ${urlString} -> ${webPath}`)
}

function rewritePageLinks(content, pageRouteMap) {
  return content.replace(PAGE_ATTR_REGEX, (fullMatch, attrName, value) => {
    if (value.startsWith('/site/')) return fullMatch

    const normalizedRoute = value.startsWith('./')
      ? normalizeRoute(value.slice(1))
      : normalizeRoute(value)
    const mappedRoute = pageRouteMap.get(normalizedRoute)

    if (!mappedRoute) return fullMatch
    return `${attrName}="${mappedRoute}"`
  })
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function rewriteTextFiles(state) {
  const replacements = [...state.resources.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .flatMap(([original, mapping]) => {
      const escapedOriginal = original.replace(/&/g, '&amp;')
      if (escapedOriginal === original) {
        return [{ original, replacement: mapping.webPath }]
      }

      return [
        { original, replacement: mapping.webPath },
        { original: escapedOriginal, replacement: mapping.webPath },
      ]
    })

  for (const filePath of state.textFiles) {
    let content = await readFile(filePath, 'utf8')

    for (const { original, replacement } of replacements) {
      const pattern = new RegExp(escapeRegExp(original), 'g')
      content = content.replace(pattern, replacement)
    }

    content = content.replaceAll(FRAMER_EDITOR_INIT_URL, LOCAL_EDITOR_INIT_URL)

    if (filePath.endsWith('.html')) {
      content = rewritePageLinks(content, state.pageRouteMap)
    }

    await writeFile(filePath, content, 'utf8')
  }
}

async function getSitemapPageUrls() {
  const sitemapUrl = new URL(SITEMAP_PATH, BASE_URL).toString()

  try {
    const response = await fetch(sitemapUrl)
    if (!response.ok) {
      throw new Error(`sitemap status ${response.status}`)
    }

    const xml = await response.text()
    const sitemapUrls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim())
    return sitemapUrls.filter((url) => ensureAllowed(url))
  } catch (error) {
    console.warn(`Could not parse sitemap.xml, using fallback paths: ${String(error)}`)
    return KNOWN_PAGE_PATHS.map((route) => new URL(route, BASE_URL).href)
  }
}

async function runSync() {
  const state = createState()

  await mkdir(outputRoot, { recursive: true })
  await writeFileSafe(
    path.join(outputRoot, '_assets', 'editor', 'init.mjs'),
    EDITOR_INIT_PLACEHOLDER,
  )

  const sitemapUrls = await getSitemapPageUrls()
  const seedUrls = new Set([
    ...sitemapUrls,
    ...KNOWN_PAGE_PATHS.map((route) => new URL(route, BASE_URL).href),
  ])

  for (const seedUrl of seedUrls) {
    enqueue(state, seedUrl)
  }

  while (state.queue.length > 0) {
    const nextUrl = state.queue.shift()
    if (!nextUrl) continue

    try {
      await processUrl(state, nextUrl)
    } catch (error) {
      console.warn(`Failed ${nextUrl}: ${String(error)}`)
    }
  }

  await rewriteTextFiles(state)

  console.log(`\nDone. Downloaded ${state.resources.size} resources.`)
  console.log('Local entry point: /site/index.html')
}

runSync().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
