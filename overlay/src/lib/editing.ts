/** Unsaved work that switching tabs would throw away. Following a new game waits while any is open. */
const open = new Set<string>()

export const markEditing = (id: string, on: boolean) => (on ? open.add(id) : open.delete(id))
export const isEditing = () => open.size > 0
