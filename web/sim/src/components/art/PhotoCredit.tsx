import Link from 'next/link'
import { memePhoto, type MemePhoto } from '@/lib/memes'
import styles from './PhotoCredit.module.css'

/** "Author (License)": the author links to the Commons page, the license to its terms; each opens in a new tab. */
export function PhotoLinks({ photo }: { photo: MemePhoto }) {
  return (
    <>
      <a className={styles.link} href={photo.page} target="_blank" rel="noopener noreferrer">
        {photo.author}
        <span className="sr-only"> on Wikimedia Commons (opens in a new tab)</span>
      </a>{' '}
      (
      {photo.licenseUrl ? (
        <a className={styles.link} href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">
          {photo.license}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        photo.license
      )}
      )
    </>
  )
}

/** The credit under a coin with a photo: author, source, license and the crop, as its license asks; all are on /credits. */
export function PhotoCredit({ meme, className }: { meme?: string; className?: string }) {
  const photo = memePhoto(meme)
  if (!photo) return null
  return (
    <p className={`${styles.credit} ${className ?? ''}`}>
      Photo: <PhotoLinks photo={photo} />, cropped ·{' '}
      <Link className={styles.link} href="/credits">
        All credits
      </Link>
    </p>
  )
}
