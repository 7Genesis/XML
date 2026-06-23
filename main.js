const { app, BrowserWindow, ipcMain } = require('electron');

function createWindow() {
    const win = new BrowserWindow({
        width: 600,
        height: 450,
        title: 'Motor de Extração XML',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });
    win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('scrape-url', async (event, url) => {
    let scrapeWindow;
    try {
        console.log('\n===== A INICIAR VARREDURA DE ALTA PERFORMANCE =====');
        console.log('Alvo:', url);

        scrapeWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            show: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
            }
        });

        const todosProdutos = [];
        let paginaAtual = url;
        let paginaNumero = 1;
        const limiteDePaginas = 50;
        const urlsVisitadas = new Set();
        let paginasSemProdutosConsecutivas = 0;

        while (paginaAtual && paginaNumero <= limiteDePaginas) {
            if (urlsVisitadas.has(paginaAtual)) {
                console.log('URL já visitada, parando extração.');
                break;
            }
            urlsVisitadas.add(paginaAtual);

            console.log(`\nA extrair Página ${paginaNumero}...`);
            event.sender.send('scrape-progress', { 
                pagina: paginaNumero, 
                totalProdutos: todosProdutos.length 
            });

            try {
                await scrapeWindow.loadURL(paginaAtual, {
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
                });
            } catch (e) {
                console.log(`Falha ao carregar página ${paginaNumero}: ${e.message}`);
                break;
            }

            await new Promise(resolve => setTimeout(resolve, 8000));

            const dados = await scrapeWindow.webContents.executeJavaScript(`
                (function() {
                    const produtos = [];
                    const cards = document.querySelectorAll('div[class*="imovel"], div[class*="box-imovel"]');
                    console.log('Total de candidatos na página:', cards.length);

                    cards.forEach((card, index) => {
                        const titleEl = card.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"], [class*="endereco"], [class*="bairro"]');
                        const priceEl = card.querySelector('[class*="price"], [class*="valor"], [class*="preco"], [class*="amount"]');
                        const imgEls = card.querySelectorAll('img');
                        const linkEl = card.querySelector('a');

                        const title = (titleEl ? titleEl.textContent : (linkEl?.textContent || '')).trim();

                        let price = '';
                        if (priceEl) {
                            price = priceEl.textContent.trim();
                        } else {
                            const matchPreco = card.textContent.match(/(R\\$|US\\$|\\$)\\s*[\\d.,]+/g);
                            if (matchPreco) price = matchPreco[0];
                        }

                        let link = linkEl?.href || '';
                        
                        // Captura TODAS as imagens do produto
                        const images = [];
                        imgEls.forEach(img => {
                            const src = img.src || img.dataset?.src || img.dataset?.original || img.dataset?.lazy || '';
                            if (src && src.startsWith('http')) {
                                if (!images.includes(src)) {
                                    images.push(src);
                                }
                            }
                        });

                        // Só aceita o card se tem TÍTULO, LINK e (PREÇO OU IMAGENS)
                        if (title && title.length > 5 && link.includes('/imovel/')) {
                            produtos.push({
                                id: 'SKU-' + Math.floor(Math.random() * 900000),
                                title: title.replace(/\\s+/g, ' ').substring(0, 150),
                                price: price,
                                images: images,
                                selectedImageIndex: 0,
                                link: link
                            });
                            console.log('Card', index, 'válido:', title.substring(0, 40));
                        } else {
                            console.log('Card', index, 'inválido:', { title: title.substring(0, 20), link: link.substring(0, 40) });
                        }
                    });

                    // Remove duplicatas da página atual
                    const unicos = [];
                    const vistos = new Set();
                    produtos.forEach(p => {
                        const key = p.link.trim();
                        if (!vistos.has(key)) {
                            vistos.add(key);
                            unicos.push(p);
                        }
                    });

                    console.log('Produtos válidos na página:', unicos.length);
                    return { produtos: unicos };
                })();
            `);

            if (dados.produtos.length === 0) {
                paginasSemProdutosConsecutivas++;
                console.log(`Nenhum produto na página ${paginaNumero} (${paginasSemProdutosConsecutivas} consecutivas)`);
                
                if (paginasSemProdutosConsecutivas >= 2) {
                    console.log('2 páginas consecutivas sem produtos. Parando extração.');
                    break;
                }
            } else {
                paginasSemProdutosConsecutivas = 0;
                todosProdutos.push(...dados.produtos);
                console.log(`+${dados.produtos.length} itens capturados. Total até agora: ${todosProdutos.length}`);
            }

            // Sempre tenta incrementar a página manualmente
            let proximoLink = null;
            try {
                const urlObj = new URL(paginaAtual);
                let paginaAtualValor = 1;
                let paginaParam = null;
                
                for (let param of urlObj.searchParams.keys()) {
                    if (param.toLowerCase() === 'pagina' || param.toLowerCase() === 'page') {
                        const val = parseInt(urlObj.searchParams.get(param));
                        if (!isNaN(val)) {
                            paginaAtualValor = val;
                            paginaParam = param;
                            break;
                        }
                    }
                }

                if (paginaParam) {
                    urlObj.searchParams.set(paginaParam, paginaAtualValor + 1);
                } else {
                    urlObj.searchParams.set('pagina', 2);
                }
                proximoLink = urlObj.toString();
                console.log(`Próxima página (incrementada): ${proximoLink}`);
            } catch (e) {
                console.log('Não foi possível gerar a próxima página automaticamente.');
                break;
            }

            paginaAtual = proximoLink;
            paginaNumero++;
        }

        // Remove duplicatas globais (todas as páginas)
        const unicosFinal = [];
        const vistosGlobal = new Set();
        todosProdutos.forEach(p => {
            const key = (p.link || p.title).trim();
            if (!vistosGlobal.has(key)) {
                vistosGlobal.add(key);
                unicosFinal.push(p);
            }
        });

        scrapeWindow.close();
        console.log(`\n===== OPERAÇÃO CONCLUÍDA! =====`);
        console.log(`Total capturado: ${todosProdutos.length}`);
        console.log(`Total sem duplicatas: ${unicosFinal.length}`);
        console.log('================================\n');
        return { success: true, produtos: unicosFinal };

    } catch (error) {
        if (scrapeWindow && !scrapeWindow.isDestroyed()) scrapeWindow.close();
        console.error('FALHA DE EXECUÇÃO:', error.message);
        return { success: false, error: error.message };
    }
});
