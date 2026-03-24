#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const NOTION_API_BASE = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'
const DEFAULT_EXPERIENCE_DATABASE_ID = '32d3192fb7678009b51dcbcbea1bb42c'

const ROOT_DIR = process.cwd()
const OUTPUT_PATH = path.join(ROOT_DIR, 'public', 'data', 'experience.json')

await loadEnvFile(path.join(ROOT_DIR, '.env.local'))
await loadEnvFile(path.join(ROOT_DIR, '.env'))

const notionToken = process.env.NOTION_TOKEN?.trim()
const databaseId = normalizeNotionId(process.env.NOTION_EXPERIENCE_DATABASE_ID ?? DEFAULT_EXPERIENCE_DATABASE_ID)

if (!notionToken) {
  console.error('Missing NOTION_TOKEN. Set it in your shell or .env.local before running sync:notion:experience.')
  process.exit(1)
}

if (!databaseId) {
  console.error('Missing NOTION_EXPERIENCE_DATABASE_ID. Provide a Notion database id or URL.')
  process.exit(1)
}

async function loadEnvFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf8')
    const lines = content.split(/\r?\n/)

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const separatorIndex = trimmed.indexOf('=')
      if (separatorIndex <= 0) continue

      const key = trimmed.slice(0, separatorIndex).trim()
      if (!key || process.env[key] !== undefined) continue

      let value = trimmed.slice(separatorIndex + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }

      process.env[key] = value
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }
}

async function notionRequest(endpoint, options = {}) {
  const response = await fetch(`${NOTION_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Notion API ${response.status} on ${endpoint}: ${body}`)
  }

  return response.json()
}

function normalizeNotionId(rawValue) {
  if (!rawValue) return ''

  const value = String(rawValue).trim()
  if (!value) return ''

  if (/^[0-9a-fA-F]{32}$/.test(value)) return value.toLowerCase()

  const fromUrl = value.match(/[0-9a-fA-F]{32}/)
  if (fromUrl) return fromUrl[0].toLowerCase()

  return value.replace(/-/g, '').toLowerCase()
}

function normalizeName(value) {
  return value.trim().toLowerCase()
}

function richTextToPlain(richText = []) {
  return richText.map((item) => item.plain_text ?? '').join('').trim()
}

function findPropertyName(properties, candidates, types = []) {
  const normalizedCandidates = candidates.map(normalizeName)

  for (const [name, property] of Object.entries(properties)) {
    if (types.length > 0 && !types.includes(property.type)) continue
    if (normalizedCandidates.includes(normalizeName(name))) return name
  }

  return null
}

function findFirstPropertyByType(properties, type) {
  for (const [name, property] of Object.entries(properties)) {
    if (property.type === type) return name
  }
  return null
}

function getProperty(page, name) {
  if (!name) return null
  return page.properties?.[name] ?? null
}

function getTextFromProperty(property) {
  if (!property || typeof property !== 'object') return ''

  switch (property.type) {
    case 'title':
      return richTextToPlain(property.title)
    case 'rich_text':
      return richTextToPlain(property.rich_text)
    case 'select':
      return property.select?.name?.trim() ?? ''
    case 'multi_select':
      return property.multi_select?.map((item) => item.name).filter(Boolean).join(', ') ?? ''
    case 'date': {
      const start = property.date?.start?.trim() ?? ''
      const end = property.date?.end?.trim() ?? ''
      if (start && end) return `${start} - ${end}`
      return start || end
    }
    case 'url':
      return property.url?.trim() ?? ''
    case 'email':
      return property.email?.trim() ?? ''
    case 'phone_number':
      return property.phone_number?.trim() ?? ''
    case 'number':
      return typeof property.number === 'number' ? String(property.number) : ''
    case 'status':
      return property.status?.name?.trim() ?? ''
    case 'people':
      return property.people?.map((person) => person.name).filter(Boolean).join(', ') ?? ''
    case 'formula': {
      const formula = property.formula
      if (!formula || typeof formula !== 'object') return ''
      if (formula.type === 'string') return formula.string?.trim() ?? ''
      if (formula.type === 'number') return typeof formula.number === 'number' ? String(formula.number) : ''
      if (formula.type === 'boolean') return formula.boolean ? 'Yes' : 'No'
      if (formula.type === 'date') {
        const start = formula.date?.start?.trim() ?? ''
        const end = formula.date?.end?.trim() ?? ''
        if (start && end) return `${start} - ${end}`
        return start || end
      }
      return ''
    }
    default:
      return ''
  }
}

function getTextProperty(page, propertyName) {
  return getTextFromProperty(getProperty(page, propertyName))
}

function getNumberProperty(page, propertyName) {
  const property = getProperty(page, propertyName)
  if (!property || typeof property !== 'object') return null

  if (property.type === 'number' && typeof property.number === 'number') {
    return property.number
  }

  if (property.type === 'formula' && property.formula?.type === 'number' && typeof property.formula.number === 'number') {
    return property.formula.number
  }

  return null
}

async function resolveSchema() {
  const database = await notionRequest(`/databases/${databaseId}`)
  const properties = database?.properties
  if (!properties || typeof properties !== 'object') {
    throw new Error('Notion database schema is unavailable for experience sync.')
  }

  const titleProperty =
    findPropertyName(properties, ['Name', 'Role', 'Title'], ['title']) ??
    findFirstPropertyByType(properties, 'title')

  const publishedProperty = findPropertyName(properties, ['Published', 'Publish', 'Visible', 'Show'], ['checkbox'])
  const positionProperty = findPropertyName(properties, ['Position', 'Order', 'Sort', 'Index'], ['number', 'formula'])
  const roleProperty = findPropertyName(properties, ['Role', 'Title', 'Job Title', 'Position', 'Name'], ['rich_text', 'title'])
  const timelineProperty = findPropertyName(properties, ['Timeline', 'Period', 'Dates', 'Date'], ['rich_text', 'date'])
  const paragraphProperty = findPropertyName(
    properties,
    ['Paragraph', 'Description', 'Summary', 'Details', 'About'],
    ['rich_text', 'title'],
  )
  const companyProperty = findPropertyName(properties, ['Company', 'Employer', 'Organization'], ['rich_text', 'title', 'select'])
  const locationProperty = findPropertyName(properties, ['Location', 'City', 'Place', 'Country'], ['rich_text', 'title', 'select'])

  return {
    titleProperty,
    publishedProperty,
    positionProperty,
    roleProperty,
    timelineProperty,
    paragraphProperty,
    companyProperty,
    locationProperty,
  }
}

async function queryPages(schema) {
  const pages = []
  let startCursor = undefined

  while (true) {
    const body = {
      page_size: 100,
      ...(schema.positionProperty
        ? { sorts: [{ property: schema.positionProperty, direction: 'ascending' }] }
        : {}),
      ...(schema.publishedProperty
        ? {
            filter: {
              property: schema.publishedProperty,
              checkbox: { equals: true },
            },
          }
        : {}),
      ...(startCursor ? { start_cursor: startCursor } : {}),
    }

    const response = await notionRequest(`/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    })

    pages.push(...response.results)

    if (!response.has_more || !response.next_cursor) break
    startCursor = response.next_cursor
  }

  return pages
}

function buildExperienceItem(page, schema) {
  const fallbackRole = getTextProperty(page, schema.titleProperty)
  const role = getTextProperty(page, schema.roleProperty) || fallbackRole

  return {
    id: page.id,
    role: role.trim(),
    timeline: getTextProperty(page, schema.timelineProperty).trim(),
    paragraph: getTextProperty(page, schema.paragraphProperty).trim(),
    company: getTextProperty(page, schema.companyProperty).trim(),
    location: getTextProperty(page, schema.locationProperty).trim(),
    order: getNumberProperty(page, schema.positionProperty) ?? Number.MAX_SAFE_INTEGER,
    updatedAt: page.last_edited_time,
    notionUrl: page.url,
  }
}

async function main() {
  const schema = await resolveSchema()
  const pages = await queryPages(schema)

  const items = pages
    .map((page) => buildExperienceItem(page, schema))
    .filter((item) => [item.role, item.timeline, item.paragraph, item.company, item.location].some(Boolean))

  const payload = {
    generatedAt: new Date().toISOString(),
    items,
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log(`Synced ${items.length} experience item(s) from Notion -> ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
