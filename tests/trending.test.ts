import { describe, expect, it } from 'vitest'
import { trending, type TitleRow } from '../server/trending.ts'

const rows = (...titles: [title: string, source: number][]): TitleRow[] =>
  titles.map(([title, source_id]) => ({ title, source_id }))

describe('trending', () => {
  it('needs at least two sources', () => {
    const recent = rows(['Zelda remake announced', 1], ['Zelda remake gets a date', 1], ['Starfield patch lands', 2])
    expect(trending(recent, [], 6)).toEqual([])
  })

  it('ranks by number of sources and keeps the common spelling', () => {
    const recent = rows(
      ['Nintendo confirms Switch 2 price', 1],
      ['Switch 2 preorders open', 2],
      ['Why the Switch 2 matters', 3],
      ['OpenAI ships a new model', 1],
      ['openai faces lawsuit', 2],
    )
    const result = trending(recent, [], 6)
    expect(result.map((trend) => trend.phrase)).toEqual(['Switch 2', 'OpenAI'])
    expect(result[0]).toMatchObject({ sources: 3, articles: 3 })
  })

  it('ignores filler words', () => {
    const recent = rows(['The best new deals this week', 1], ['Best deals of the week', 2])
    expect(trending(recent, [], 6)).toEqual([])
  })

  it('drops phrases that are no more frequent than usual', () => {
    const recent = rows(['Apple updates iOS', 1], ['Apple sued again', 2], ['Palworld sequel leaks', 1], ['Palworld sequel confirmed', 2])
    const baseline = rows(...Array.from({ length: 18 }, (_, n): [string, number] => [`Apple story ${n}`, (n % 2) + 1]))
    expect(trending(recent, baseline, 6).map((trend) => trend.phrase)).toEqual(['Palworld sequel'])
  })
})
