import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      className="rounded-md border border-zinc-200 p-1.5 text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
