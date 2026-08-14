export default async function handler(req, res) {
    const { acc_no, bank } = req.query;

    if (!acc_no || !bank) {
        return res.status(400).json({ error: 'Missing acc_no or bank' });
    }

    try {
        const response = await fetch(
            `https://nu-alt.shop/v1/resolve?acc_no=${acc_no}&bank=${bank}`,
            {
                headers: {
                    'Authorization': 'Bearer ' + process.env.NUALT_API_KEY
                }
            }
        );

        const data = await response.text();

        res.setHeader('Content-Type', 'application/json');
        return res.status(200).send(data);
    } catch (err) {
        console.error('Resolve error:', err);
        return res.status(500).json({ error: 'Failed to verify account' });
    }
}
