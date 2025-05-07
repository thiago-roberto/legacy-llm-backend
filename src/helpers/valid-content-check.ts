export const isValidContent = (text: string) => {
    if (/^[a-f0-9]{24}$/i.test(text)) return false;

    if (/^\s*[\d\s.,;:-]+\s*$/.test(text)) return false;

    if (text.length < 10 || text.length > 1000) return false;

    const alphaRatio = (text.replace(/[^a-z]/gi, '').length || 0) / text.length;
    if (alphaRatio < 0.4) return false;

    return true;
};