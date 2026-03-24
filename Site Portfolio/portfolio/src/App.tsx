import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type LoadedPage = {
  title: string
  bodyHtml: string
  globalFontCss: string
}

type NotionCase = {
  id: string
  slug: string
  title: string
  cardDescription: string
  cardImage: string | null
  tags: string[]
  order: number
  updatedAt: string
  notionUrl: string
  contentHtml: string
  projectSummary: string
  role: string
  problem: string
  results: string[]
  introHeading: string
  introBody: string
  middleHeading: string
  middleBody: string
  finalHeading: string
  finalBody: string
  heroImage: string | null
  imageGallery: Array<string | null>
  tickerCarouselOne: Array<string | null>
  tickerCarouselTwo: Array<string | null>
}

type NotionCasesPayload = {
  generatedAt: string
  cases: NotionCase[]
}

type NotionExperienceItem = {
  id: string
  role: string
  timeline: string
  paragraph: string
  company: string
  location: string
  order: number
  updatedAt: string
  notionUrl: string
}

type NotionExperiencePayload = {
  generatedAt: string
  items: NotionExperienceItem[]
}

const INTERNAL_TOP_LEVEL_SITE_REGEX = /^\/site\/(projects|experience)\/index\.html$/
const INTERNAL_PROJECT_SITE_REGEX = /^\/site\/projects\/([^/]+)\/index\.html$/
const LOW_OPACITY_REGEX = /opacity\s*:\s*0?\.0*1\b/gi
const ZERO_OPACITY_REGEX = /opacity\s*:\s*0(?=[;\s]|$)/gi
const TRANSLATE_Y_REGEX = /transform\s*:\s*translateY\([^)]*\)\s*;?/gi
const WILL_CHANGE_REGEX = /will-change\s*:[^;]*;?/gi
const CORE_SOURCE_PATHS = ['/site/index.html', '/site/projects/index.html', '/site/experience/index.html']
const PAGE_CACHE = new Map<string, Promise<LoadedPage>>()
const STATIC_PAGE_CACHE_VERSION = 'v4-projects-heading-style'
const CASES_DATA_PATH = '/data/cases.json'
const EXPERIENCE_DATA_PATH = '/data/experience.json'
const SLOW_SCROLL_MULTIPLIER = 0.575
const SLOW_SCROLL_EASING = 0.22
const PROJECT_TEMPLATE_SOURCE_PATH = '/site/projects/11111/index.html'
const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const USER_INFO_SELECTOR = '[data-framer-name="User Information"]'
const SIDEBAR_HEADER_LINE_ONE = 'I\u2019m Egor.'
const SIDEBAR_HEADER_LINE_TWO = 'I make products work better.'
const CASE_IMAGE_NAMES = ['Image 1', 'Image 2', 'Image 3', 'Image 4', 'Image 5', 'Image 6'] as const
const CAROUSEL_ONE_IMAGE_NAMES = [
  'Carousel 1 Image 1',
  'Carousel 1 Image 2',
  'Carousel 1 Image 3',
] as const
const CAROUSEL_TWO_IMAGE_NAMES = [
  'Carousel 2 Image 1',
  'Carousel 2 Image 2',
  'Carousel 2 Image 3',
] as const
const HOME_PROJECTS_HEADING = 'Last Projects'
const PROJECTS_MAIN_HEADING = 'All Projects'
const FOOTER_SOCIAL_LINKS = [
  { label: 'E-mail', href: 'mailto:egorstasevichwork@gmail.com' },
  { label: 'Telegram', href: 'https://t.me/egordesigner' },
  { label: 'Linkedin', href: 'https://www.linkedin.com/in/egorstasevich/' },
] as const

let notionCasesRequest: Promise<NotionCasesPayload> | null = null
let notionExperienceRequest: Promise<NotionExperiencePayload> | null = null

function isScrollableContainer(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false

  const style = window.getComputedStyle(element)
  const overflowY = style.overflowY
  if (!/(auto|scroll|overlay)/.test(overflowY)) return false

  return element.scrollHeight > element.clientHeight + 1
}

function hasNestedScrollableAncestor(start: Element | null): boolean {
  let current = start
  while (current && current !== document.body && current !== document.documentElement) {
    if (isScrollableContainer(current)) return true
    current = current.parentElement
  }

  return false
}

function shouldUseNativeWheel(event: WheelEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return true
  }

  const target = event.target
  if (!(target instanceof Element)) return false

  if (
    target.closest(
      'input, textarea, select, button, [contenteditable="true"], [data-native-scroll]',
    )
  ) {
    return true
  }

  return hasNestedScrollableAncestor(target)
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/'
  return `/${pathname.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

function sourcePathnameToRoute(pathname: string): string | null {
  const normalized = normalizePathname(pathname)

  if (normalized === '/' || normalized === '/site' || normalized === '/site/index.html') return '/'
  if (normalized === '/projects' || normalized === '/experience') return normalized
  if (normalized === '/site/projects') return '/projects'
  if (normalized === '/site/experience') return '/experience'

  const topLevelMatch = normalized.match(INTERNAL_TOP_LEVEL_SITE_REGEX)
  if (topLevelMatch) {
    return `/${topLevelMatch[1]}`
  }

  const projectMatch = normalized.match(INTERNAL_PROJECT_SITE_REGEX)
  if (projectMatch) {
    return `/projects/${projectMatch[1]}`
  }

  const projectFolderMatch = normalized.match(/^\/site\/projects\/([^/]+)$/)
  if (projectFolderMatch) {
    return `/projects/${projectFolderMatch[1]}`
  }

  return null
}

function normalizeRoutePathname(pathname: string): string {
  return sourcePathnameToRoute(pathname) ?? normalizePathname(pathname)
}

function routeToSourcePath(pathname: string): string | null {
  const normalized = normalizeRoutePathname(pathname)

  if (normalized === '/') return '/site/index.html'
  if (normalized === '/projects' || normalized === '/experience') {
    return `/site${normalized}/index.html`
  }

  if (/^\/projects\/[^/]+$/.test(normalized)) {
    return `/site${normalized}/index.html`
  }

  return null
}

function sourceHrefToRoute(href: string): string | null {
  const trimmedHref = href.trim()
  if (!trimmedHref || trimmedHref.startsWith('#')) return null

  let resolvedUrl: URL
  try {
    resolvedUrl = new URL(trimmedHref, window.location.href)
  } catch {
    return null
  }

  if (resolvedUrl.origin !== window.location.origin) return null

  return sourcePathnameToRoute(resolvedUrl.pathname)
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.length > 0 ? value : null
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function parseNullableStringArray(value: unknown): Array<string | null> {
  if (!Array.isArray(value)) return []

  return value.map((item) => {
    if (typeof item !== 'string') return null
    return item.length > 0 ? item : null
  })
}

function mutateHtmlBlock(html: string, mutator: (root: HTMLElement) => void): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString('<!doctype html><html><body><div id="portfolio-root"></div></body></html>', 'text/html')
  const root = doc.getElementById('portfolio-root')
  if (!root) return html

  root.innerHTML = html
  mutator(root)
  return root.innerHTML
}

function hasVisibleValue(value: string | null | undefined): boolean {
  return Boolean(value && value.trim())
}

function setSectionVisibility(root: ParentNode, framerName: string, visible: boolean): void {
  const sections = root.querySelectorAll<HTMLElement>(`[data-framer-name="${framerName}"]`)
  for (const section of sections) {
    section.style.display = visible ? '' : 'none'
  }
}

function applyTextToFramerName(
  root: ParentNode,
  framerName: string,
  nextText: string,
  options?: { hideWhenEmpty?: boolean },
): void {
  const textValue = nextText.trim()
  const hideWhenEmpty = options?.hideWhenEmpty ?? true
  const sections = root.querySelectorAll<HTMLElement>(`[data-framer-name="${framerName}"]`)

  for (const section of sections) {
    const textNode = section.querySelector<HTMLElement>('h1, h2, h3, p')
    if (textNode) {
      textNode.textContent = textValue
    }

    if (hideWhenEmpty && !textValue) {
      section.style.display = 'none'
    } else {
      section.style.display = ''
    }
  }
}

function applyImageToFramerName(
  root: ParentNode,
  framerName: string,
  imageUrl: string | null,
  fallbackAlt: string,
  options?: { hideWhenEmpty?: boolean },
): void {
  const hideWhenEmpty = options?.hideWhenEmpty ?? true
  const hasImage = Boolean(imageUrl)
  const sections = root.querySelectorAll<HTMLElement>(`[data-framer-name="${framerName}"]`)

  for (const section of sections) {
    if (hideWhenEmpty && !hasImage) {
      section.style.display = 'none'
    } else {
      section.style.display = ''
    }

    const images = section.querySelectorAll<HTMLImageElement>('img')
    for (const image of images) {
      if (hasImage && imageUrl) {
        image.src = imageUrl
        image.setAttribute('src', imageUrl)
        image.alt = fallbackAlt
      } else {
        image.removeAttribute('src')
        image.alt = ''
      }

      image.removeAttribute('srcset')
      image.removeAttribute('sizes')
      image.removeAttribute('data-framer-original-sizes')
    }
  }
}

function applyImageSeries(
  root: ParentNode,
  imageNames: readonly string[],
  imageUrls: Array<string | null>,
  fallbackAlt: string,
): void {
  imageNames.forEach((imageName, index) => {
    const imageUrl = imageUrls[index] ?? null
    applyImageToFramerName(root, imageName, imageUrl, fallbackAlt)
  })
}

function buildHomePageWithNotionCases(basePage: LoadedPage, cases: NotionCase[]): LoadedPage {
  if (cases.length === 0) return basePage

  const homeCases = cases.slice(0, 3)

  if (homeCases.length === 0) return basePage

  const nextBodyHtml = mutateHtmlBlock(basePage.bodyHtml, (root) => {
    const projectsSection = root.querySelector<HTMLElement>(
      'main[data-framer-name="Main"] section[data-framer-name="Projects Section"]',
    )
    if (!projectsSection) return

    const headingText = projectsSection.querySelector<HTMLElement>(
      '[data-framer-name="Heading"] h1, [data-framer-name="Heading"] h2, [data-framer-name="Heading"] h3, [data-framer-name="Heading"] h4, [data-framer-name="Heading"] p, [data-framer-name="Heading"] span',
    )
    if (headingText) {
      headingText.textContent = HOME_PROJECTS_HEADING
    }

    const cardAnchors = Array.from(projectsSection.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(
      (anchor) => /^\/site\/projects\/[^/]+\/index\.html$/.test(anchor.getAttribute('href') ?? ''),
    )
    if (cardAnchors.length === 0) return

    const templateAnchor = cardAnchors[0]
    const parent = templateAnchor.parentElement
    if (!parent) return

    for (const anchor of cardAnchors) {
      anchor.remove()
    }

    for (const caseItem of homeCases) {
      const slug = caseItem.slug.trim()
      if (!slug) continue

      const nextAnchor = templateAnchor.cloneNode(true) as HTMLAnchorElement
      nextAnchor.setAttribute('href', `/site/projects/${slug}/index.html`)

      const alt = caseItem.title ? `${caseItem.title} preview` : 'Project preview'
      const images = nextAnchor.querySelectorAll<HTMLImageElement>('img')
      for (const image of images) {
        if (caseItem.cardImage) {
          image.src = caseItem.cardImage
          image.setAttribute('src', caseItem.cardImage)
          image.style.opacity = ''
        } else {
          image.setAttribute('src', TRANSPARENT_PIXEL)
          image.style.opacity = '0'
        }

        image.removeAttribute('srcset')
        image.removeAttribute('sizes')
        image.removeAttribute('data-framer-original-sizes')
        image.alt = alt
      }

      const wrappers = nextAnchor.querySelectorAll<HTMLElement>('[data-framer-background-image-wrapper="true"]')
      for (const wrapper of wrappers) {
        wrapper.style.background = caseItem.cardImage
          ? ''
          : 'linear-gradient(135deg, rgb(240, 240, 240), rgb(224, 224, 224))'
      }

      parent.appendChild(nextAnchor)
    }
  })

  return {
    ...basePage,
    bodyHtml: nextBodyHtml,
  }
}

function buildProjectsPageWithNotion(basePage: LoadedPage, cases: NotionCase[]): LoadedPage {
  if (cases.length === 0) return basePage

  const nextBodyHtml = mutateHtmlBlock(basePage.bodyHtml, (root) => {
    const cardsContainers = Array.from(
      root.querySelectorAll<HTMLElement>('main[data-framer-name="Main"] section.framer-1dyz6lw'),
    )

    for (const cardsContainer of cardsContainers) {
      const anchors = Array.from(cardsContainer.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((anchor) =>
        /^\/site\/projects\/[^/]+\/index\.html$/.test(anchor.getAttribute('href') ?? ''),
      )
      if (anchors.length === 0) continue

      const templateAnchor = anchors[0]
      const parent = templateAnchor.parentElement
      if (!parent) continue

      for (const anchor of anchors) {
        anchor.remove()
      }

      for (const caseItem of cases) {
        const slug = caseItem.slug.trim()
        if (!slug) continue

        const nextAnchor = templateAnchor.cloneNode(true) as HTMLAnchorElement
        nextAnchor.setAttribute('href', `/site/projects/${slug}/index.html`)

        const alt = caseItem.title ? `${caseItem.title} preview` : 'Project preview'
        const images = nextAnchor.querySelectorAll<HTMLImageElement>('img')
        for (const image of images) {
          if (caseItem.cardImage) {
            image.src = caseItem.cardImage
            image.setAttribute('src', caseItem.cardImage)
            image.style.opacity = ''
          } else {
            image.setAttribute('src', TRANSPARENT_PIXEL)
            image.style.opacity = '0'
          }

          image.removeAttribute('srcset')
          image.removeAttribute('sizes')
          image.removeAttribute('data-framer-original-sizes')
          image.alt = alt
        }

        const wrappers = nextAnchor.querySelectorAll<HTMLElement>('[data-framer-background-image-wrapper="true"]')
        for (const wrapper of wrappers) {
          wrapper.style.background = caseItem.cardImage
            ? ''
            : 'linear-gradient(135deg, rgb(240, 240, 240), rgb(224, 224, 224))'
        }

        parent.appendChild(nextAnchor)
      }
    }
  })

  return {
    ...basePage,
    bodyHtml: nextBodyHtml,
  }
}

function ensureProjectsMainHeading(basePage: LoadedPage): LoadedPage {
  const nextBodyHtml = mutateHtmlBlock(basePage.bodyHtml, (root) => {
    const main = root.querySelector<HTMLElement>('main[data-framer-name="Main"]')
    if (!main) return

    main.querySelectorAll<HTMLElement>('[data-codex-projects-heading="true"]').forEach((node) => node.remove())

    const cardsSections = Array.from(main.querySelectorAll<HTMLElement>('section.framer-1dyz6lw'))
    if (cardsSections.length === 0) return

    const doc = main.ownerDocument
    for (const cardsSection of cardsSections) {
      const heading = doc.createElement('div')
      heading.className = 'framer-codex-projects-heading'
      heading.setAttribute('data-codex-projects-heading', 'true')
      heading.setAttribute('data-framer-name', 'Heading')

      const headingText = doc.createElement('h4')
      headingText.className = 'framer-text'
      headingText.textContent = PROJECTS_MAIN_HEADING

      heading.appendChild(headingText)
      cardsSection.insertBefore(heading, cardsSection.firstChild)
    }
  })

  return {
    ...basePage,
    bodyHtml: nextBodyHtml,
  }
}

function buildExperiencePageWithNotion(basePage: LoadedPage, items: NotionExperienceItem[]): LoadedPage {
  if (items.length === 0) return basePage

  const nextBodyHtml = mutateHtmlBlock(basePage.bodyHtml, (root) => {
    const experienceSection = root.querySelector<HTMLElement>(
      'main[data-framer-name="Main"] section[data-framer-name="Experience Section"]',
    )
    if (!experienceSection) return

    const collectEntries = (variantSelector: string, cardName: string) =>
      Array.from(experienceSection.querySelectorAll<HTMLElement>(variantSelector))
        .map((variant) => {
          const card = variant.querySelector<HTMLElement>(`[data-framer-name="${cardName}"]`)
          if (!card) return null

          const hasCoreFields =
            card.querySelector('[data-framer-name="Timeline"]') ||
            card.querySelector('[data-framer-name="Paragraph"]') ||
            card.querySelector('[data-framer-name="Company"]')
          if (!hasCoreFields) return null

          return { variant, card }
        })
        .filter((entry): entry is { variant: HTMLElement; card: HTMLElement } => entry !== null)

    const desktopEntries = collectEntries(':scope > .ssr-variant.hidden-z458pc', 'Default')
    const mobileEntries = collectEntries(':scope > .ssr-variant.hidden-rfdswf.hidden-19lxa9u', 'Mobile')

    const maxRenderableItems = Math.min(desktopEntries.length, mobileEntries.length)
    if (maxRenderableItems === 0) return

    const visibleCount = Math.min(items.length, maxRenderableItems)

    const applyExperienceItem = (card: HTMLElement, item: NotionExperienceItem) => {
      applyTextToFramerName(card, 'Role', item.role)
      applyTextToFramerName(card, 'Timeline', item.timeline)
      applyTextToFramerName(card, 'Paragraph', item.paragraph)
      applyTextToFramerName(card, 'Company', item.company)
      applyTextToFramerName(card, 'Location', item.location)
    }

    for (let index = 0; index < maxRenderableItems; index += 1) {
      const showItem = index < visibleCount
      const desktopEntry = desktopEntries[index]
      const mobileEntry = mobileEntries[index]

      if (desktopEntry) desktopEntry.variant.style.display = showItem ? '' : 'none'
      if (mobileEntry) mobileEntry.variant.style.display = showItem ? '' : 'none'

      if (!showItem) continue

      const item = items[index]
      applyExperienceItem(desktopEntry.card, item)
      applyExperienceItem(mobileEntry.card, item)
    }

    const dividers = Array.from(experienceSection.querySelectorAll<HTMLElement>(':scope > [data-framer-name="Divider"]'))
    const visibleDividerCount = Math.max(visibleCount - 1, 0)
    dividers.forEach((divider, index) => {
      divider.style.display = index < visibleDividerCount ? '' : 'none'
    })
  })

  return {
    ...basePage,
    bodyHtml: nextBodyHtml,
  }
}

function buildProjectCasePageFromNotionTemplate(basePage: LoadedPage, caseItem: NotionCase): LoadedPage {
  const nextBodyHtml = mutateHtmlBlock(basePage.bodyHtml, (root) => {
    const projectSection = root.querySelector<HTMLElement>('[data-framer-name="Project Section"]')
    if (!projectSection) return

    const caseTitle = caseItem.title.trim()
    const projectSummary = caseItem.projectSummary.trim()
    const role = caseItem.role.trim()
    const problem = caseItem.problem.trim()
    const results = [0, 1, 2, 3].map((index) => (caseItem.results[index] ?? '').trim())
    const introHeading = caseItem.introHeading.trim()
    const introBody = caseItem.introBody.trim()
    const middleHeading = caseItem.middleHeading.trim()
    const middleBody = caseItem.middleBody.trim()
    const finalHeading = caseItem.finalHeading.trim()
    const finalBody = caseItem.finalBody.trim()

    applyTextToFramerName(projectSection, 'Header', caseTitle)
    applyTextToFramerName(projectSection, 'Project Summary', projectSummary)

    setSectionVisibility(projectSection, 'Role Section', hasVisibleValue(role))
    applyTextToFramerName(projectSection, 'Role', role)

    setSectionVisibility(projectSection, 'Problem Section', hasVisibleValue(problem))
    applyTextToFramerName(projectSection, 'Problem', problem)

    const hasResults = results.some((value) => hasVisibleValue(value))
    setSectionVisibility(projectSection, 'Results Section', hasResults)
    applyTextToFramerName(projectSection, 'Result 1', results[0] ?? '')
    applyTextToFramerName(projectSection, 'Result 2', results[1] ?? '')
    applyTextToFramerName(projectSection, 'Result 3', results[2] ?? '')
    applyTextToFramerName(projectSection, 'Result 4', results[3] ?? '')

    const hasIntro = hasVisibleValue(introHeading) || hasVisibleValue(introBody)
    setSectionVisibility(projectSection, 'Intro Section', hasIntro)
    applyTextToFramerName(projectSection, 'Intro Section Heading', introHeading)
    applyTextToFramerName(projectSection, 'Intro Section Body', introBody)

    const hasMiddle = hasVisibleValue(middleHeading) || hasVisibleValue(middleBody)
    setSectionVisibility(projectSection, 'Middle Section', hasMiddle)
    applyTextToFramerName(projectSection, 'Heading', middleHeading)
    applyTextToFramerName(projectSection, 'Middle Section Body 1', middleBody)

    const hasFinal = hasVisibleValue(finalHeading) || hasVisibleValue(finalBody)
    setSectionVisibility(projectSection, 'Final Section', hasFinal)
    applyTextToFramerName(projectSection, 'Final Section Heading', finalHeading)
    applyTextToFramerName(projectSection, 'Final Section Body', finalBody)

    const fallbackAlt = caseItem.title ? `${caseItem.title} image` : 'Project image'
    applyImageToFramerName(projectSection, 'Hero Image', caseItem.heroImage, fallbackAlt)

    const hasGalleryOne = caseItem.imageGallery.slice(0, 3).some((imageUrl) => Boolean(imageUrl))
    const hasGalleryTwo = caseItem.imageGallery.slice(3, 6).some((imageUrl) => Boolean(imageUrl))
    setSectionVisibility(projectSection, 'Images 1 & 2 & 3', hasGalleryOne)
    setSectionVisibility(projectSection, 'Images 4 & 5 & 6', hasGalleryTwo)
    applyImageSeries(projectSection, CASE_IMAGE_NAMES, caseItem.imageGallery, fallbackAlt)

    const hasTickerOne = caseItem.tickerCarouselOne.some((imageUrl) => Boolean(imageUrl))
    const hasTickerTwo = caseItem.tickerCarouselTwo.some((imageUrl) => Boolean(imageUrl))
    setSectionVisibility(projectSection, 'Tickers', hasTickerOne || hasTickerTwo)
    applyImageSeries(projectSection, CAROUSEL_ONE_IMAGE_NAMES, caseItem.tickerCarouselOne, fallbackAlt)
    applyImageSeries(projectSection, CAROUSEL_TWO_IMAGE_NAMES, caseItem.tickerCarouselTwo, fallbackAlt)
  })

  return {
    ...basePage,
    title: `${caseItem.title.trim() || 'Project'} | Egor Stasevich`,
    bodyHtml: nextBodyHtml,
  }
}

function ensureSidebarIdentityVisible(basePage: LoadedPage): LoadedPage {
  const nextBodyHtml = mutateHtmlBlock(basePage.bodyHtml, (root) => {
    const blocks = root.querySelectorAll<HTMLElement>(
      `${USER_INFO_SELECTOR} [data-framer-name="Name"], ${USER_INFO_SELECTOR} [data-framer-name="Role"], ${USER_INFO_SELECTOR} [data-framer-name="Experience"]`,
    )

    for (const block of blocks) {
      block.style.display = ''
    }

    const avatarCards = root.querySelectorAll<HTMLElement>('[data-framer-name="Avatar Card / Front"]')
    for (const avatarCard of avatarCards) {
      const upperContent = avatarCard.closest<HTMLElement>('[data-framer-name="Upper Content"]')
      if (!upperContent) continue

      const headerSection =
        upperContent.querySelector<HTMLElement>(':scope > [data-framer-name="Header"]') ??
        upperContent.querySelector<HTMLElement>('[data-framer-name="Header"]')
      if (!headerSection) continue

      const textNode = headerSection.querySelector<HTMLElement>('h1, h2, h3, p')
      if (!textNode) continue

      headerSection.style.display = ''
      textNode.innerHTML = `${SIDEBAR_HEADER_LINE_ONE}<br>${SIDEBAR_HEADER_LINE_TWO}`
    }
  })

  return {
    ...basePage,
    bodyHtml: nextBodyHtml,
  }
}

function ensureExperienceSidebarUserInfo(basePage: LoadedPage): LoadedPage {
  const nextBodyHtml = mutateHtmlBlock(basePage.bodyHtml, (root) => {
    const desktopAboutSection = root.querySelector<HTMLElement>(
      '.ssr-variant.hidden-12p2zyk section[data-framer-name="About"]',
    )
    if (!desktopAboutSection) return

    if (desktopAboutSection.querySelector(`${USER_INFO_SELECTOR}.framer-rh7tod`)) return

    const bottomContent = desktopAboutSection.querySelector<HTMLElement>('[data-framer-name="Bottom Content"]')
    if (!bottomContent) return

    for (const existingUserInfo of desktopAboutSection.querySelectorAll<HTMLElement>(USER_INFO_SELECTOR)) {
      existingUserInfo.remove()
    }

    const doc = bottomContent.ownerDocument
    const userInfo = doc.createElement('div')
    userInfo.className = 'framer-rh7tod'
    userInfo.setAttribute('data-framer-name', 'User Information')

    const name = doc.createElement('div')
    name.className = 'framer-1yopt80'
    name.setAttribute('data-framer-name', 'Name')
    name.setAttribute('data-framer-component-type', 'RichTextContainer')
    name.setAttribute(
      'style',
      '--extracted-1eung3n:var(--token-8630332f-f73d-45bd-9778-588fb77b4732, rgb(51, 51, 51));--framer-link-text-color:rgb(0, 153, 255);--framer-link-text-decoration:underline;transform:none',
    )
    const nameText = doc.createElement('h4')
    nameText.className = 'framer-text framer-styles-preset-u6lwds'
    nameText.setAttribute('data-styles-preset', 'JPeo61aOr')
    nameText.setAttribute(
      'style',
      '--framer-text-alignment:left;--framer-text-color:var(--extracted-1eung3n, var(--token-8630332f-f73d-45bd-9778-588fb77b4732, rgb(51, 51, 51)))',
    )
    nameText.textContent = 'Egor Stasevich'
    name.appendChild(nameText)

    const role = doc.createElement('div')
    role.className = 'framer-nsvo1w'
    role.setAttribute('data-framer-name', 'Role')
    role.setAttribute('data-framer-component-type', 'RichTextContainer')
    role.setAttribute(
      'style',
      '--extracted-r6o4lv:var(--token-8175a5ef-24f7-4cd0-a5c0-fd20cd232236, rgb(84, 84, 84));--framer-link-text-color:rgb(0, 153, 255);--framer-link-text-decoration:underline;transform:none',
    )
    const roleText = doc.createElement('p')
    roleText.className = 'framer-text framer-styles-preset-1ujn2lw'
    roleText.setAttribute('data-styles-preset', 'cB9iXc2mU')
    roleText.setAttribute(
      'style',
      '--framer-text-alignment:left;--framer-text-color:var(--extracted-r6o4lv, var(--token-8175a5ef-24f7-4cd0-a5c0-fd20cd232236, rgb(84, 84, 84)))',
    )
    roleText.textContent = 'Senior Product Designer'
    role.appendChild(roleText)

    const experience = doc.createElement('div')
    experience.className = 'framer-1niom9f'
    experience.setAttribute('data-framer-name', 'Experience')
    experience.setAttribute('data-framer-component-type', 'RichTextContainer')
    experience.setAttribute(
      'style',
      '--extracted-r6o4lv:var(--token-8175a5ef-24f7-4cd0-a5c0-fd20cd232236, rgb(84, 84, 84));--framer-link-text-color:rgb(0, 153, 255);--framer-link-text-decoration:underline;transform:none',
    )
    const experienceText = doc.createElement('p')
    experienceText.className = 'framer-text framer-styles-preset-1ujn2lw'
    experienceText.setAttribute('data-styles-preset', 'cB9iXc2mU')
    experienceText.setAttribute(
      'style',
      '--framer-text-alignment:left;--framer-text-color:var(--extracted-r6o4lv, var(--token-8175a5ef-24f7-4cd0-a5c0-fd20cd232236, rgb(84, 84, 84)))',
    )
    experienceText.textContent = '6+ years of experience'
    experience.appendChild(experienceText)

    userInfo.appendChild(name)
    userInfo.appendChild(role)
    userInfo.appendChild(experience)

    bottomContent.appendChild(userInfo)
  })

  return {
    ...basePage,
    bodyHtml: nextBodyHtml,
  }
}

function ensureFooterSocialLinks(basePage: LoadedPage): LoadedPage {
  const nextBodyHtml = mutateHtmlBlock(basePage.bodyHtml, (root) => {
    const linkBars = root.querySelectorAll<HTMLElement>('footer [data-framer-name="Link Bar"]')

    for (const linkBar of linkBars) {
      const anchors = Array.from(linkBar.querySelectorAll<HTMLAnchorElement>('a[href]'))
      if (anchors.length === 0) continue

      FOOTER_SOCIAL_LINKS.forEach((social, index) => {
        const anchor = anchors[index]
        if (!anchor) return

        anchor.setAttribute('href', social.href)
        anchor.removeAttribute('data-framer-page-link-current')

        if (social.href.startsWith('mailto:')) {
          anchor.removeAttribute('target')
          anchor.removeAttribute('rel')
        } else {
          anchor.setAttribute('target', '_blank')
          anchor.setAttribute('rel', 'noopener')
        }

        const textNode = anchor.querySelector<HTMLElement>('p, h1, h2, h3, h4, span')
        if (textNode) {
          textNode.textContent = social.label
        }
      })

      for (let index = FOOTER_SOCIAL_LINKS.length; index < anchors.length; index += 1) {
        const extraAnchor = anchors[index]
        const itemContainer = extraAnchor.parentElement
        if (itemContainer && itemContainer.parentElement === linkBar) {
          itemContainer.style.display = 'none'
        } else {
          extraAnchor.style.display = 'none'
        }
      }
    }
  })

  return {
    ...basePage,
    bodyHtml: nextBodyHtml,
  }
}

function parseNotionCases(payload: unknown): NotionCasesPayload {
  if (!payload || typeof payload !== 'object') {
    return { generatedAt: '', cases: [] }
  }

  const source = payload as Record<string, unknown>
  const generatedAt = typeof source.generatedAt === 'string' ? source.generatedAt : ''
  const rawCases = Array.isArray(source.cases) ? source.cases : []

  const cases: NotionCase[] = rawCases
    .map((rawCase) => {
      if (!rawCase || typeof rawCase !== 'object') return null
      const item = rawCase as Record<string, unknown>

      if (typeof item.slug !== 'string' || typeof item.title !== 'string') return null

      return {
        id: typeof item.id === 'string' ? item.id : item.slug,
        slug: item.slug,
        title: item.title,
        cardDescription: stringOrEmpty(item.cardDescription),
        cardImage: stringOrNull(item.cardImage),
        tags: parseStringArray(item.tags),
        order: typeof item.order === 'number' ? item.order : Number.MAX_SAFE_INTEGER,
        updatedAt: stringOrEmpty(item.updatedAt),
        notionUrl: stringOrEmpty(item.notionUrl),
        contentHtml: stringOrEmpty(item.contentHtml),
        projectSummary: stringOrEmpty(item.projectSummary),
        role: stringOrEmpty(item.role),
        problem: stringOrEmpty(item.problem),
        results: parseStringArray(item.results),
        introHeading: stringOrEmpty(item.introHeading),
        introBody: stringOrEmpty(item.introBody),
        middleHeading: stringOrEmpty(item.middleHeading),
        middleBody: stringOrEmpty(item.middleBody),
        finalHeading: stringOrEmpty(item.finalHeading),
        finalBody: stringOrEmpty(item.finalBody),
        heroImage: stringOrNull(item.heroImage),
        imageGallery: parseNullableStringArray(item.imageGallery),
        tickerCarouselOne: parseNullableStringArray(item.tickerCarouselOne),
        tickerCarouselTwo: parseNullableStringArray(item.tickerCarouselTwo),
      }
    })
    .filter((item): item is NotionCase => item !== null)

  return { generatedAt, cases }
}

function parseNotionExperience(payload: unknown): NotionExperiencePayload {
  if (!payload || typeof payload !== 'object') {
    return { generatedAt: '', items: [] }
  }

  const source = payload as Record<string, unknown>
  const generatedAt = typeof source.generatedAt === 'string' ? source.generatedAt : ''
  const rawItems = Array.isArray(source.items) ? source.items : []

  const items: NotionExperienceItem[] = rawItems
    .map((rawItem) => {
      if (!rawItem || typeof rawItem !== 'object') return null
      const item = rawItem as Record<string, unknown>

      return {
        id: stringOrEmpty(item.id),
        role: stringOrEmpty(item.role),
        timeline: stringOrEmpty(item.timeline),
        paragraph: stringOrEmpty(item.paragraph),
        company: stringOrEmpty(item.company),
        location: stringOrEmpty(item.location),
        order: typeof item.order === 'number' ? item.order : Number.MAX_SAFE_INTEGER,
        updatedAt: stringOrEmpty(item.updatedAt),
        notionUrl: stringOrEmpty(item.notionUrl),
      }
    })
    .filter((item): item is NotionExperienceItem => item !== null)

  return { generatedAt, items }
}

async function loadNotionCases(): Promise<NotionCasesPayload> {
  if (notionCasesRequest) return notionCasesRequest

  notionCasesRequest = fetch(CASES_DATA_PATH, { cache: 'no-cache' })
    .then(async (response) => {
      if (response.status === 404) {
        return { generatedAt: '', cases: [] }
      }

      if (!response.ok) {
        throw new Error(`Failed to load ${CASES_DATA_PATH}: ${response.status}`)
      }

      const data = (await response.json()) as unknown
      return parseNotionCases(data)
    })
    .catch((error) => {
      notionCasesRequest = null
      throw error
    })

  return notionCasesRequest
}

async function loadNotionExperience(): Promise<NotionExperiencePayload> {
  if (notionExperienceRequest) return notionExperienceRequest

  notionExperienceRequest = fetch(EXPERIENCE_DATA_PATH, { cache: 'no-cache' })
    .then(async (response) => {
      if (response.status === 404) {
        return { generatedAt: '', items: [] }
      }

      if (!response.ok) {
        throw new Error(`Failed to load ${EXPERIENCE_DATA_PATH}: ${response.status}`)
      }

      const data = (await response.json()) as unknown
      return parseNotionExperience(data)
    })
    .catch((error) => {
      notionExperienceRequest = null
      throw error
    })

  return notionExperienceRequest
}

async function loadStaticPage(sourcePath: string): Promise<LoadedPage> {
  const response = await fetch(sourcePath, { cache: 'no-cache' })
  if (!response.ok) {
    throw new Error(`Failed to load ${sourcePath}: ${response.status}`)
  }

  const htmlText = await response.text()
  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlText, 'text/html')

  doc.querySelectorAll('script').forEach((node) => node.remove())
  doc.querySelectorAll('link[rel="modulepreload"]').forEach((node) => node.remove())

  const appearNodes = doc.querySelectorAll<HTMLElement>('[data-framer-appear-id]')
  for (const node of appearNodes) {
    const style = node.getAttribute('style') ?? ''
    let nextStyle = style
      .replace(LOW_OPACITY_REGEX, 'opacity:1')
      .replace(TRANSLATE_Y_REGEX, '')
      .replace(WILL_CHANGE_REGEX, '')
      .replace(/;;+/g, ';')
      .trim()

    if (nextStyle.startsWith(';')) nextStyle = nextStyle.slice(1).trim()
    if (nextStyle.endsWith(';')) nextStyle = nextStyle.slice(0, -1).trim()

    if (nextStyle.length > 0) {
      node.setAttribute('style', nextStyle)
    } else {
      node.removeAttribute('style')
    }

    node.removeAttribute('data-framer-appear-id')
  }

  const lowOpacityNodes = doc.querySelectorAll<HTMLElement>(
    '[style*="opacity:0.001"], [style*="opacity:.001"]',
  )
  for (const node of lowOpacityNodes) {
    const style = node.getAttribute('style')
    if (!style) continue
    const nextStyle = style.replace(LOW_OPACITY_REGEX, 'opacity:1')
    node.setAttribute('style', nextStyle)
  }

  const skillChipOpacityNodes = doc.querySelectorAll<HTMLElement>(
    '[data-framer-name="Skill Chips"] [style*="opacity:0"]',
  )
  for (const node of skillChipOpacityNodes) {
    const style = node.getAttribute('style')
    if (!style) continue
    const nextStyle = style.replace(ZERO_OPACITY_REGEX, 'opacity:1')
    node.setAttribute('style', nextStyle)
  }

  doc.querySelector('#__framer-badge-container')?.remove()
  doc.querySelector('#template-overlay')?.remove()

  const globalFontCssChunks: string[] = []
  const routeHeadStyles: string[] = []

  for (const node of Array.from(doc.head.querySelectorAll('style, link[rel="stylesheet"]'))) {
    if (node.tagName === 'STYLE') {
      const css = node.textContent ?? ''
      if (css.includes('@font-face')) {
        globalFontCssChunks.push(css)
        continue
      }
    }

    routeHeadStyles.push(node.outerHTML)
  }

  return {
    title: doc.title || 'Portfolio',
    bodyHtml: `${routeHeadStyles.join('')}${doc.body.innerHTML}`,
    globalFontCss: globalFontCssChunks.join('\n'),
  }
}

function loadStaticPageCached(sourcePath: string): Promise<LoadedPage> {
  const cacheKey = `${STATIC_PAGE_CACHE_VERSION}:${sourcePath}`
  const cached = PAGE_CACHE.get(cacheKey)
  if (cached) return cached

  const request = loadStaticPage(sourcePath).catch((error) => {
    PAGE_CACHE.delete(cacheKey)
    throw error
  })

  PAGE_CACHE.set(cacheKey, request)
  return request
}

function App() {
  const [pathname, setPathname] = useState(() => {
    const normalized = normalizeRoutePathname(window.location.pathname)
    if (normalized !== window.location.pathname) {
      window.history.replaceState({}, '', normalized)
    }
    return normalized
  })
  const [page, setPage] = useState<LoadedPage | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadedSourcePath, setLoadedSourcePath] = useState<string | null>(null)
  const [notionCases, setNotionCases] = useState<NotionCase[] | null>(null)
  const [notionExperience, setNotionExperience] = useState<NotionExperienceItem[] | null>(null)
  const [notionError, setNotionError] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const globalFontsStyleRef = useRef<HTMLStyleElement | null>(null)
  const injectedFontCssRef = useRef(new Set<string>())
  const slowScrollFrameRef = useRef<number | null>(null)
  const slowScrollTargetRef = useRef(0)
  const routeScrollFrameRef = useRef<number | null>(null)

  const isProjectsRoute = pathname === '/projects'
  const isHomeRoute = pathname === '/'
  const projectSlugMatch = pathname.match(/^\/projects\/([^/]+)$/)
  const projectSlug = projectSlugMatch?.[1] ?? null

  const activeNotionCase = useMemo(() => {
    if (!projectSlug || !notionCases) return null
    return notionCases.find((caseItem) => caseItem.slug === projectSlug) ?? null
  }, [notionCases, projectSlug])

  const isWaitingForCases = Boolean(projectSlug) && notionCases === null && !notionError
  const sourcePath = useMemo(() => {
    if (isWaitingForCases) return null
    if (activeNotionCase) return PROJECT_TEMPLATE_SOURCE_PATH
    return routeToSourcePath(pathname)
  }, [activeNotionCase, isWaitingForCases, pathname])
  const isRouteNotFound = !isWaitingForCases && sourcePath === null

  const animateRouteScrollToTop = useCallback(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      return
    }

    const startTop = window.scrollY
    if (startTop <= 1) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      return
    }

    const durationMs = 720
    const startTime = performance.now()
    const easeInOutCubic = (progress: number) =>
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2

    const step = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(1, elapsed / durationMs)
      const easedProgress = easeInOutCubic(progress)
      const nextTop = startTop * (1 - easedProgress)
      window.scrollTo({ top: nextTop, left: 0, behavior: 'auto' })

      if (progress < 1) {
        routeScrollFrameRef.current = window.requestAnimationFrame(step)
      } else {
        routeScrollFrameRef.current = null
        slowScrollTargetRef.current = 0
      }
    }

    routeScrollFrameRef.current = window.requestAnimationFrame(step)
  }, [])

  const navigate = useCallback(
    (nextPath: string) => {
      const normalized = normalizeRoutePathname(nextPath)
      if (normalized === pathname) return

      if (slowScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(slowScrollFrameRef.current)
        slowScrollFrameRef.current = null
      }
      if (routeScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(routeScrollFrameRef.current)
        routeScrollFrameRef.current = null
      }
      slowScrollTargetRef.current = 0

      window.history.pushState({}, '', normalized)
      setPathname(normalized)
      animateRouteScrollToTop()
    },
    [animateRouteScrollToTop, pathname],
  )

  useEffect(() => {
    let cancelled = false

    loadNotionCases()
      .then((payload) => {
        if (cancelled) return

        setNotionCases(payload.cases)
        setNotionError(null)
      })
      .catch((error) => {
        if (cancelled) return

        setNotionCases([])
        setNotionError(error instanceof Error ? error.message : 'Failed to load Notion cases')
      })

    loadNotionExperience()
      .then((payload) => {
        if (cancelled) return

        setNotionExperience(payload.items)
      })
      .catch(() => {
        if (cancelled) return
        setNotionExperience([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onPopState = () => {
      setPathname(normalizeRoutePathname(window.location.pathname))
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  useEffect(() => {
    slowScrollTargetRef.current = window.scrollY

    const maxScrollTop = () =>
      Math.max(0, document.documentElement.scrollHeight - window.innerHeight)

    const step = () => {
      const currentTop = window.scrollY
      const distance = slowScrollTargetRef.current - currentTop

      if (Math.abs(distance) < 0.5) {
        window.scrollTo({ top: slowScrollTargetRef.current, left: 0, behavior: 'auto' })
        slowScrollFrameRef.current = null
        return
      }

      window.scrollTo({
        top: currentTop + distance * SLOW_SCROLL_EASING,
        left: 0,
        behavior: 'auto',
      })
      slowScrollFrameRef.current = window.requestAnimationFrame(step)
    }

    const onWheel = (event: WheelEvent) => {
      if (shouldUseNativeWheel(event)) return

      if (routeScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(routeScrollFrameRef.current)
        routeScrollFrameRef.current = null
      }

      event.preventDefault()

      slowScrollTargetRef.current += event.deltaY * SLOW_SCROLL_MULTIPLIER
      slowScrollTargetRef.current = Math.min(maxScrollTop(), Math.max(0, slowScrollTargetRef.current))

      if (slowScrollFrameRef.current === null) {
        slowScrollFrameRef.current = window.requestAnimationFrame(step)
      }
    }

    const onScroll = () => {
      if (slowScrollFrameRef.current === null) {
        slowScrollTargetRef.current = window.scrollY
      }
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('scroll', onScroll)
      if (slowScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(slowScrollFrameRef.current)
        slowScrollFrameRef.current = null
      }
      if (routeScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(routeScrollFrameRef.current)
        routeScrollFrameRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!sourcePath) return

    loadStaticPageCached(sourcePath)
      .then((nextPage) => {
        if (cancelled) return

        setPage(nextPage)
        setLoadError(null)
        setLoadedSourcePath(sourcePath)
      })
      .catch((nextLoadError) => {
        if (cancelled) return

        setLoadError(nextLoadError instanceof Error ? nextLoadError.message : 'Failed to load page')
        setLoadedSourcePath(sourcePath)
      })

    return () => {
      cancelled = true
    }
  }, [sourcePath])

  useEffect(() => {
    if (!page?.globalFontCss) return

    const cssChunk = page.globalFontCss.trim()
    if (!cssChunk || injectedFontCssRef.current.has(cssChunk)) return

    let styleTag = globalFontsStyleRef.current
    if (!styleTag) {
      styleTag = document.createElement('style')
      styleTag.id = 'portfolio-global-fonts'
      document.head.appendChild(styleTag)
      globalFontsStyleRef.current = styleTag
    }

    styleTag.textContent = `${styleTag.textContent ?? ''}\n${cssChunk}`.trim()
    injectedFontCssRef.current.add(cssChunk)
  }, [page])

  useEffect(() => {
    if (!sourcePath) return

    for (const path of CORE_SOURCE_PATHS) {
      if (path === sourcePath) continue
      void loadStaticPageCached(path).catch(() => {})
    }
  }, [sourcePath])

  const renderedPage = useMemo(() => {
    if (!page) return null

    let nextPage = page

    if (activeNotionCase) {
      nextPage = buildProjectCasePageFromNotionTemplate(nextPage, activeNotionCase)
      nextPage = ensureFooterSocialLinks(nextPage)
      return ensureSidebarIdentityVisible(nextPage)
    }

    if (isProjectsRoute) {
      nextPage = ensureProjectsMainHeading(nextPage)
      if (notionCases) {
        nextPage = buildProjectsPageWithNotion(nextPage, notionCases)
      }
    }

    if (isHomeRoute && notionCases) {
      nextPage = buildHomePageWithNotionCases(nextPage, notionCases)
    }

    if (pathname === '/experience') {
      if (notionExperience && notionExperience.length > 0) {
        nextPage = buildExperiencePageWithNotion(nextPage, notionExperience)
      }
      nextPage = ensureExperienceSidebarUserInfo(nextPage)
    }

    nextPage = ensureFooterSocialLinks(nextPage)
    return ensureSidebarIdentityVisible(nextPage)
  }, [activeNotionCase, isHomeRoute, isProjectsRoute, notionCases, notionExperience, page, pathname])

  useEffect(() => {
    if (renderedPage) {
      document.title = renderedPage.title
    }
  }, [renderedPage])

  useEffect(() => {
    const container = contentRef.current
    if (!container) return

    const nextSourcePaths = new Set<string>()
    const anchors = container.querySelectorAll<HTMLAnchorElement>('a[href]')

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href')
      if (!href) continue

      const route = sourceHrefToRoute(href)
      if (!route) continue

      const nextSource = routeToSourcePath(route)
      if (!nextSource || nextSource === sourcePath) continue

      nextSourcePaths.add(nextSource)
    }

    for (const nextSource of nextSourcePaths) {
      void loadStaticPageCached(nextSource).catch(() => {})
    }
  }, [renderedPage, sourcePath])

  useEffect(() => {
    const container = contentRef.current
    if (!container) return

    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return
      }

      const target = event.target
      if (!(target instanceof Element)) return

      const anchor = target.closest('a[href]')
      if (!(anchor instanceof HTMLAnchorElement)) return

      const href = anchor.getAttribute('href')
      if (!href) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return

      const nextRoute = sourceHrefToRoute(href)
      if (!nextRoute) return

      event.preventDefault()
      navigate(nextRoute)
    }

    container.addEventListener('click', onClick)
    return () => {
      container.removeEventListener('click', onClick)
    }
  }, [navigate, renderedPage])

  const isCurrentRouteReady = loadedSourcePath === sourcePath
  const currentRouteError = isCurrentRouteReady ? loadError : null

  if (isWaitingForCases) {
    return (
      <main className="static-shell">
        <section className="status-block">
          <h1>Loading Cases</h1>
          <p>Подгружаем данные из Notion…</p>
        </section>
      </main>
    )
  }

  if (isRouteNotFound || currentRouteError) {
    return (
      <main className="static-shell">
        <section className="status-block">
          <h1>Page Not Found</h1>
          <p>{currentRouteError ?? 'This route does not exist in the local portfolio.'}</p>
          <button type="button" onClick={() => navigate('/')}>
            Go Home
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="static-shell">
      <div
        ref={contentRef}
        className="static-page"
        dangerouslySetInnerHTML={{ __html: renderedPage?.bodyHtml ?? '' }}
      />
    </main>
  )
}

export default App
