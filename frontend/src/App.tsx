import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Library from './views/Library'
import Reader from './views/Reader'
import Import from './views/Import'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Library />} />
        <Route path="/import" element={<Import />} />
        <Route path="/reader/:documentId" element={<Reader />} />
      </Route>
    </Routes>
  )
}
