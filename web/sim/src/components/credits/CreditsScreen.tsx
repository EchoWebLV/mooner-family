// Credits for the coin photos (spec §6): each one's author, source and license, as the licenses ask.
import Image from 'next/image'
import { PhotoLinks } from '@/components/art/PhotoCredit'
import { MEME_PHOTOS } from '@/lib/memes'
import { TOKEN_IDEAS } from '@/lib/sim/personas'
import styles from './Credits.module.css'

const ROWS = TOKEN_IDEAS.flatMap((idea) => {
  const photo = MEME_PHOTOS[idea.ticker]
  return photo ? [{ idea, photo }] : []
})

export function CreditsScreen() {
  return (
    <div className={`page page-narrow ${styles.screen}`}>
      <header className={styles.head}>
        <h1 className="page-title">Credits</h1>
        <p className={styles.lede}>
          The coins are named after internet memes, and most show a photo in the meme&apos;s spirit: the real animal
          where a free photo exists, like Moo Deng and Grumpy Cat, otherwise one of the same kind or a stand-in. Memes
          that are drawings or phrases, like Wojak and Few Understand, keep Mooner&apos;s generated art.
        </p>
        <p className={styles.lede}>
          The photos are free-licensed images from Wikimedia Commons, cropped to squares and resized. Each is credited
          below; its Commons page has the original and the full terms. Our crops of CC BY-SA photos are shared under the
          same license. No endorsement by the authors is implied.
        </p>
      </header>

      <section className="panel" aria-labelledby="credits-photos">
        <h2 id="credits-photos" className={`panel-title ${styles.title}`}>
          Coin photos · <span className="num">{ROWS.length}</span>
        </h2>
        <ul className={styles.list}>
          {ROWS.map(({ idea, photo }) => (
            <li key={idea.ticker} className={styles.item}>
              <Image className={styles.thumb} src={photo.src} width={48} height={48} alt="" />
              <div className={styles.text}>
                <p>
                  <span className={styles.name}>{idea.name}</span> <span className="num faint">${idea.ticker}</span>
                </p>
                <p className={styles.file} title={photo.file}>
                  {photo.file}
                </p>
                <p>
                  <PhotoLinks photo={photo} />
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
