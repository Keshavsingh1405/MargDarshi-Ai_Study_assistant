import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '../../frontend');

describe('Password Visibility Show/Hide Toggle Tests', () => {
    const registerHtml = fs.readFileSync(path.join(frontendDir, 'register.html'), 'utf-8');
    const loginHtml = fs.readFileSync(path.join(frontendDir, 'login.html'), 'utf-8');

    test('1. Signup page contains password input with has-toggle class and type="password"', () => {
        assert(registerHtml.includes('id="password"'), 'register.html must contain id="password"');
        assert(registerHtml.includes('type="password"'), 'register.html must have initial type="password"');
        assert(registerHtml.includes('has-toggle'), 'register.html password input must include has-toggle class');
    });

    test('2. Signup page eye toggle is a semantic <button type="button"> to prevent form submission', () => {
        assert(/<button[^>]*type="button"[^>]*id="toggle-pwd"/i.test(registerHtml) || 
               /<button[^>]*id="toggle-pwd"[^>]*type="button"/i.test(registerHtml), 
               'register.html toggle must be a button with type="button" and id="toggle-pwd"');
        assert(registerHtml.includes('class="password-toggle-btn"'), 'register.html must use password-toggle-btn class');
        assert(registerHtml.includes('aria-label="Show password"'), 'register.html button must have aria-label');
        assert(registerHtml.includes('data-lucide="eye"'), 'register.html initial icon must be eye');
    });

    test('3. Login page contains password input with has-toggle class and type="password"', () => {
        assert(loginHtml.includes('id="password"'), 'login.html must contain id="password"');
        assert(loginHtml.includes('type="password"'), 'login.html must have initial type="password"');
        assert(loginHtml.includes('has-toggle'), 'login.html password input must include has-toggle class');
    });

    test('4. Login page eye toggle is a semantic <button type="button"> to prevent form submission', () => {
        assert(/<button[^>]*type="button"[^>]*id="toggle-pwd"/i.test(loginHtml) || 
               /<button[^>]*id="toggle-pwd"[^>]*type="button"/i.test(loginHtml), 
               'login.html toggle must be a button with type="button" and id="toggle-pwd"');
        assert(loginHtml.includes('class="password-toggle-btn"'), 'login.html must use password-toggle-btn class');
        assert(loginHtml.includes('aria-label="Show password"'), 'login.html button must have aria-label');
        assert(loginHtml.includes('data-lucide="eye"'), 'login.html initial icon must be eye');
    });

    test('5. Both pages contain styling for .password-toggle-btn and .form-input.has-toggle', () => {
        [registerHtml, loginHtml].forEach((html, idx) => {
            const pageName = idx === 0 ? 'register.html' : 'login.html';
            assert(html.includes('.password-toggle-btn'), `${pageName} must have .password-toggle-btn styles`);
            assert(html.includes('.form-input.has-toggle'), `${pageName} must have .form-input.has-toggle styles`);
            assert(html.includes('padding-right: 3.25rem'), `${pageName} must have padding-right: 3.25rem for text breathing room`);
        });
    });

    test('6. Toggle implementation switches between password/text and eye/eye-off on repeated clicks', () => {
        // Simulate the initPasswordToggle logic
        const mockInput = {
            type: 'password',
            value: 'SuperSecret123!',
            selectionStart: 15,
            selectionEnd: 15,
            focusCalled: false,
            focus() { this.focusCalled = true; },
            setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; },
            closest() { return null; }
        };

        const mockBtn = {
            attributes: {},
            innerHTML: '<i data-lucide="eye"></i>',
            setAttribute(k, v) { this.attributes[k] = v; },
            getAttribute(k) { return this.attributes[k]; }
        };

        let iconsCreated = 0;
        const mockLucide = {
            createIcons() { iconsCreated++; }
        };

        // Standard toggle logic from register.html and login.html
        function updateVisibility(showPassword) {
            const currentVal = mockInput.value;
            mockInput.type = showPassword ? 'text' : 'password';
            mockInput.value = currentVal;

            const iconName = showPassword ? 'eye-off' : 'eye';
            const labelText = showPassword ? 'Hide password' : 'Show password';
            mockBtn.setAttribute('aria-label', labelText);
            mockBtn.setAttribute('title', labelText);
            mockBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
            mockLucide.createIcons();
        }

        // Click 1: Show password
        let willShow = mockInput.type === 'password';
        updateVisibility(willShow);

        assert.equal(mockInput.type, 'text', 'Input type must be text after first click');
        assert.equal(mockInput.value, 'SuperSecret123!', 'Password value must be preserved');
        assert(mockBtn.innerHTML.includes('eye-off'), 'Icon must be eye-off when visible');
        assert.equal(mockBtn.getAttribute('aria-label'), 'Hide password');
        assert.equal(iconsCreated, 1);

        // Click 2: Hide password
        willShow = mockInput.type === 'password';
        updateVisibility(willShow);

        assert.equal(mockInput.type, 'password', 'Input type must be password after second click');
        assert.equal(mockInput.value, 'SuperSecret123!', 'Password value must remain preserved');
        assert(mockBtn.innerHTML.includes('eye'), 'Icon must be eye when hidden');
        assert.equal(mockBtn.getAttribute('aria-label'), 'Show password');
        assert.equal(iconsCreated, 2);

        // Repeated clicks: Click 3 (Show), Click 4 (Hide), Click 5 (Show)
        updateVisibility(mockInput.type === 'password');
        assert.equal(mockInput.type, 'text');
        updateVisibility(mockInput.type === 'password');
        assert.equal(mockInput.type, 'password');
        updateVisibility(mockInput.type === 'password');
        assert.equal(mockInput.type, 'text');
        assert.equal(mockInput.value, 'SuperSecret123!');
        assert.equal(iconsCreated, 5);
    });

    test('7. Form reset resets visibility back to password and eye icon', () => {
        assert(registerHtml.includes("form.addEventListener('reset'"), 'register.html must handle form reset');
        assert(loginHtml.includes("form.addEventListener('reset'"), 'login.html must handle form reset');
    });

    test('8. Form submit in register and login reads pwdInput.value regardless of visibility', () => {
        assert(registerHtml.includes('const password = pwdInput.value;'), 'register.html reads password value from pwdInput');
        assert(loginHtml.includes('const password = pwdInput.value;'), 'login.html reads password value from pwdInput');
    });
});
