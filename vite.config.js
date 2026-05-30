import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//  Change this line to an arrow function that destructures 'mode'
export default defineConfig(({ mode }) => {
  return {
    plugins: [react()],
    base: mode === 'ghpages' ? '/Doost/' : './'
  }
})