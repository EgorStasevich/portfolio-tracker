#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const NOTION_API_BASE = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'
const DEFAULT_DATABASE_ID = '32c3192fb76780e297b7cabe14b20b73'

const ROOT_DIR = process.cwd()
const OUTPUT_PATH = path.join(ROOT_DIR, 'public', 'data', 'cases.json')
const CASE_IMAGE_PROPERTY_NAMES = ['Image 1', 'Image 2', 'Image 3', 'Image 4', 'Image 5', 'Image 6']
const CAROUSEL_ONE_PROPERTY_NAMES = ['Carousel 1 Image 1', 'Carousel 1 Image 2', 'Carousel 1 Image 3']
const CAROUSEL_TWO_PROPERTY_NAMES = ['Carousel 2 Image 1', 'Carousel 2 Image 2', 'Carousel 2 Image 3']

await loadEnvFile(path.join(ROOT_DIR, '.env.local'))
await loadEnvFile(path.join(ROOT_DIR, '.env'))

const notionToken = process.env.NOTION_TOKEN?.trim()
const databaseId = normalizeNotionId(process.env.NOTION_DATABASE_ID ?? DEFAULT_DATABASE_ID)

if (!notionToken) {
  console.error('Missing NOTION_TOKEN. Set it in your shell or .env.local before running sync:notion.')
  process.exit(1)
}

if (!databaseId) {
  console.error('Missing NOTION_DATABASE_ID. Provide a Notion database id or URL.')
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

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function notionColorToCss(color) {
  const map = {
    default: '',
    gray: '#9aa0a6',
    brown: '#b5865c',
    orange: '#d9822b',
    yellow: '#d4b23f',
    green: '#4fa16d',
    blue: '#5b8def',
    purple: '#8f6ad8',
    pink: '#d772b7',
    red: '#d66868',
  }

  return map[color] ?? ''
}

function richTextToPlain(richText = []) {
  return richText.map((item) => item.plain_text ?? '').join('')
}

function richTextToHtml(richText = []) {
  if (!Array.isArray(richText) || richText.length === 0) return ''

  return richText
    .map((item) => {
      const rawText = item.plain_text ?? ''
      if (!rawText) return ''

      let html = escapeHtml(rawText)
      const annotations = item.annotations ?? {}

      if (annotations.code) html = `<code>${html}</code>`
      if (annotations.bold) html = `<strong>${html}</strong>`
      if (annotations.italic) html = `<em>${html}</em>`
      if (annotations.strikethrough) html = `<s>${html}</s>`
      if (annotations.underline) html = `<u>${html}</u>`

      const color = notionColorToCss(annotations.color)
      if (color) {
        html = `<span style="color:${color}">${html}</span>`
      }

      const href = item.href
      if (href) {
        const safeHref = escapeHtml(href)
        html = `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${html}</a>`
      }

      return html
    })
    .join('')
}

function slugify(input) {
  const normalized = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

  return normalized
}

function getProperty(page, name) {
  return page.properties?.[name]
}

function getRichTextProperty(page, name) {
  const property = getProperty(page, name)
  if (property?.type !== 'rich_text') return ''
  return richTextToPlain(property.rich_text).trim()
}

function getUrlProperty(page, name) {
  const property = getProperty(page, name)
  if (property?.type !== 'url') return null

  const value = property.url?.trim()
  return value ? value : null
}

function readImageProperties(page, names) {
  return names.map((name) => getUrlProperty(page, name))
}

function getTitle(page) {
  const titleProp = getProperty(page, 'Name')
  if (titleProp?.type === 'title') {
    const title = richTextToPlain(titleProp.title)
    if (title) return title
  }

  for (const property of Object.values(page.properties ?? {})) {
    if (property?.type === 'title') {
      const title = richTextToPlain(property.title)
      if (title) return title
    }
  }

  return 'Untitled case'
}

function getSlug(page, fallbackTitle) {
  const slugProp = getProperty(page, 'Slug')
  if (slugProp?.type === 'rich_text') {
    const value = richTextToPlain(slugProp.rich_text)
    const slug = slugify(value)
    if (slug) return slug
  }

  const fallbackSlug = slugify(fallbackTitle)
  if (fallbackSlug) return fallbackSlug

  return page.id.replace(/-/g, '').slice(0, 12)
}

function getCardDescription(page) {
  const descriptionProp = getProperty(page, 'Card Description')
  if (descriptionProp?.type === 'rich_text') {
    return richTextToPlain(descriptionProp.rich_text)
  }

  return ''
}

function getTags(page) {
  const tagsProp = getProperty(page, 'Tags')
  if (tagsProp?.type === 'multi_select') {
    return tagsProp.multi_select.map((tag) => tag.name).filter(Boolean)
  }

  return []
}

function getSitePosition(page) {
  const positionProp = getProperty(page, 'Position')
  if (positionProp?.type === 'number' && typeof positionProp.number === 'number') {
    return positionProp.number
  }

  const orderProp = getProperty(page, 'Order')
  if (orderProp?.type === 'number' && typeof orderProp.number === 'number') {
    return orderProp.number
  }

  return Number.MAX_SAFE_INTEGER
}

function getCardImage(page) {
  const cardImageProp = getProperty(page, 'Card Image')
  if (cardImageProp?.type === 'url' && cardImageProp.url) {
    return cardImageProp.url
  }

  if (page.cover?.type === 'external') {
    return page.cover.external?.url ?? null
  }

  if (page.cover?.type === 'file') {
    return page.cover.file?.url ?? null
  }

  return null
}

function getCaseStructuredContent(page) {
  return {
    projectSummary: getRichTextProperty(page, 'Project Summary'),
    role: getRichTextProperty(page, 'Role'),
    problem: getRichTextProperty(page, 'Problem'),
    results: [
      getRichTextProperty(page, 'Result 1'),
      getRichTextProperty(page, 'Result 2'),
      getRichTextProperty(page, 'Result 3'),
      getRichTextProperty(page, 'Result 4'),
    ],
    introHeading: getRichTextProperty(page, 'Intro Heading'),
    introBody: getRichTextProperty(page, 'Intro Body'),
    middleHeading: getRichTextProperty(page, 'Middle Heading'),
    middleBody: getRichTextProperty(page, 'Middle Body'),
    finalHeading: getRichTextProperty(page, 'Final Heading'),
    finalBody: getRichTextProperty(page, 'Final Body'),
    heroImage: getUrlProperty(page, 'Hero Image'),
    imageGallery: readImageProperties(page, CASE_IMAGE_PROPERTY_NAMES),
    tickerCarouselOne: readImageProperties(page, CAROUSEL_ONE_PROPERTY_NAMES),
    tickerCarouselTwo: readImageProperties(page, CAROUSEL_TWO_PROPERTY_NAMES),
  }
}

async function resolveSortProperty() {
  const database = await notionRequest(`/databases/${databaseId}`)
  const properties = database?.properties
  if (!properties || typeof properties !== 'object') return null

  if (Object.hasOwn(properties, 'Position')) return 'Position'
  if (Object.hasOwn(properties, 'Order')) return 'Order'

  return null
}

async function queryDatabasePages() {
  const pages = []
  let startCursor = undefined
  const sortProperty = await resolveSortProperty()

  while (true) {
    const body = {
      page_size: 100,
      ...(sortProperty ? { sorts: [{ property: sortProperty, direction: 'ascending' }] } : {}),
      filter: {
        property: 'Published',
        checkbox: { equals: true },
      },
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

async function fetchBlockChildren(blockId) {
  const children = []
  let startCursor = undefined

  while (true) {
    const query = new URLSearchParams({ page_size: '100' })
    if (startCursor) query.set('start_cursor', startCursor)

    const response = await notionRequest(`/blocks/${blockId}/children?${query.toString()}`)
    children.push(...response.results)

    if (!response.has_more || !response.next_cursor) break
    startCursor = response.next_cursor
  }

  return children
}

async function renderListItem(block, type) {
  const data = block[type]
  const content = richTextToHtml(data.rich_text)

  let childrenHtml = ''
  if (block.has_children) {
    const children = await fetchBlockChildren(block.id)
    childrenHtml = await renderBlocks(children)
  }

  return `<li>${content}${childrenHtml}</li>`
}

async function renderBlock(block) {
  const type = block.type

  switch (type) {
    case 'paragraph': {
      const html = richTextToHtml(block.paragraph.rich_text)
      if (!html) return ''
      return `<p>${html}</p>`
    }
    case 'heading_1':
      return `<h1>${richTextToHtml(block.heading_1.rich_text)}</h1>`
    case 'heading_2':
      return `<h2>${richTextToHtml(block.heading_2.rich_text)}</h2>`
    case 'heading_3':
      return `<h3>${richTextToHtml(block.heading_3.rich_text)}</h3>`
    case 'quote':
      return `<blockquote>${richTextToHtml(block.quote.rich_text)}</blockquote>`
    case 'divider':
      return '<hr />'
    case 'to_do': {
      const checked = block.to_do.checked ? ' checked' : ''
      return `<p><input type="checkbox" disabled${checked} /> ${richTextToHtml(block.to_do.rich_text)}</p>`
    }
    case 'code': {
      const codeText = richTextToPlain(block.code.rich_text)
      const language = block.code.language || 'plain'
      return `<pre><code class="language-${escapeHtml(language)}">${escapeHtml(codeText)}</code></pre>`
    }
    case 'callout': {
      const icon = block.callout.icon?.emoji ? `${block.callout.icon.emoji} ` : ''
      const content = richTextToHtml(block.callout.rich_text)
      return `<blockquote>${icon}${content}</blockquote>`
    }
    case 'image': {
      const image = block.image
      const imageUrl = image.type === 'external' ? image.external.url : image.file.url
      const caption = richTextToHtml(image.caption)
      const safeUrl = escapeHtml(imageUrl)
      if (caption) {
        return `<figure><img src="${safeUrl}" alt="" loading="lazy" /><figcaption>${caption}</figcaption></figure>`
      }
      return `<img src="${safeUrl}" alt="" loading="lazy" />`
    }
    case 'bookmark': {
      const safeUrl = escapeHtml(block.bookmark.url)
      return `<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a></p>`
    }
    case 'embed': {
      const safeUrl = escapeHtml(block.embed.url)
      return `<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a></p>`
    }
    case 'video': {
      const video = block.video
      const videoUrl = video.type === 'external' ? video.external.url : video.file.url
      const safeUrl = escapeHtml(videoUrl)
      return `<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a></p>`
    }
    case 'toggle': {
      const summary = richTextToHtml(block.toggle.rich_text)
      let childrenHtml = ''
      if (block.has_children) {
        const children = await fetchBlockChildren(block.id)
        childrenHtml = await renderBlocks(children)
      }
      return `<details><summary>${summary}</summary>${childrenHtml}</details>`
    }
    case 'child_page':
      return `<h3>${escapeHtml(block.child_page.title)}</h3>`
    default:
      return ''
  }
}

async function renderBlocks(blocks) {
  const html = []

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    const type = block.type

    if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
      const listTag = type === 'bulleted_list_item' ? 'ul' : 'ol'
      const items = []

      while (index < blocks.length && blocks[index].type === type) {
        items.push(await renderListItem(blocks[index], type))
        index += 1
      }

      index -= 1
      html.push(`<${listTag}>${items.join('')}</${listTag}>`)
      continue
    }

    html.push(await renderBlock(block))
  }

  return html.join('')
}

async function buildCase(page) {
  const title = getTitle(page)
  const slug = getSlug(page, title)
  const blocks = await fetchBlockChildren(page.id)
  const contentHtml = await renderBlocks(blocks)
  const structured = getCaseStructuredContent(page)

  return {
    id: page.id,
    slug,
    title,
    cardDescription: getCardDescription(page),
    cardImage: getCardImage(page),
    tags: getTags(page),
    order: getSitePosition(page),
    updatedAt: page.last_edited_time,
    notionUrl: page.url,
    contentHtml,
    ...structured,
  }
}

async function main() {
  const pages = await queryDatabasePages()
  const cases = []

  for (const page of pages) {
    cases.push(await buildCase(page))
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    cases,
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log(`Synced ${cases.length} case(s) from Notion -> ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
